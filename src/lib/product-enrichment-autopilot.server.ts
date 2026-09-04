/**
 * Orquestrador do piloto automático de enriquecimento de catálogo.
 *
 * Executado apenas no servidor (worker do cron ou disparo interno):
 *  1. adquire a lease de execução por tenant (product_enrichment_runs);
 *  2. enfileira produtos incompletos elegíveis (RPC idempotente);
 *  3. reivindica um lote pequeno de jobs (FOR UPDATE SKIP LOCKED);
 *  4. invoca o motor `process-manufacturer-enrichment` em modo worker;
 *  5. copia imagens para o Storage próprio e tenta a autoaprovação
 *     conservadora (RPC `auto_approve_product_enrichment_candidate`);
 *  6. registra métricas do ciclo na tabela de runs.
 *
 * Nenhum tenant vem do cliente: a lista sai do banco e cada job carrega o
 * próprio tenant_id. Toda promoção de dados é validada novamente no Postgres.
 */
import { tdb } from "@/integrations/supabase/tenant-db";

const MAX_TENANTS_PER_TICK = 5;
const ENQUEUE_LIMIT = 25;
const CLAIM_LIMIT = 2;
const ENGINE_TIMEOUT_MS = 235_000;
const COPY_TIMEOUT_MS = 90_000;
const MAX_DETAILS = 20;
const OFFICIAL_SUPABASE_URL = "https://pzwjbitjersngordgcsh.supabase.co";
const ADMIN_BRIDGE_URL = `${OFFICIAL_SUPABASE_URL}/functions/v1/server-admin-bridge`;

type EngineJobResult = {
  jobId: string;
  status: string;
  reason?: string;
  sourceName?: string;
  galleryImages?: number;
  applications?: number;
};

export type AutopilotTenantSummary = {
  tenantId: string;
  runId: string | null;
  skipped: boolean;
  enqueued: number;
  claimed: number;
  processed: number;
  autoApproved: number;
  sentReview: number;
  requeued: number;
  failed: number;
  imagesCopied: number;
  error: string | null;
  details: Array<{ jobId?: string; candidateId?: string; status: string; reason?: string }>;
};

export type AutopilotResult = {
  ok: boolean;
  trigger: "cron" | "manual";
  startedAt: string;
  finishedAt: string;
  tenants: AutopilotTenantSummary[];
};

function bridgeCredential() {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["AUTH_RATE_LIMIT_PEPPER"];
  if (!key || key.length < 32) {
    throw new Error("Credencial server-only da ponte oficial não configurada");
  }
  return key;
}

async function invokeEdgeFunction<T>(name: string, payload: unknown, timeoutMs: number): Promise<T> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Nome de Edge Function inválido");
  const key = bridgeCredential();
  const response = await fetch(ADMIN_BRIDGE_URL, {
    method: "POST",
    headers: {
      "x-cutover-key": key,
      "x-proxy-path": `/functions/v1/${name}`,
      "x-proxy-method": "POST",
      "x-forward-content-type": "application/json",
      "x-forward-accept": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? `Função ${name} respondeu ${response.status}`);
  }
  return body;
}

type AutoApproveOutcome = {
  ok?: boolean;
  eligible?: boolean;
  needs_image_copy?: boolean;
  reason?: string;
  candidate_id?: string;
};

export async function runEnrichmentAutopilot(options: {
  trigger: "cron" | "manual";
  tenantId?: string;
}): Promise<AutopilotResult> {
  const startedAt = new Date().toISOString();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = tdb(supabaseAdmin);

  let tenantIds: string[] = [];
  if (options.tenantId) {
    tenantIds = [options.tenantId];
  } else {
    const { data: tenants, error } = await admin
      .from("tenants")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(MAX_TENANTS_PER_TICK);
    if (error) throw new Error(error.message);
    tenantIds = (tenants ?? []).map((row: { id: string }) => row.id);
  }

  const summaries: AutopilotTenantSummary[] = [];

  for (const tenantId of tenantIds) {
    const summary: AutopilotTenantSummary = {
      tenantId,
      runId: null,
      skipped: false,
      enqueued: 0,
      claimed: 0,
      processed: 0,
      autoApproved: 0,
      sentReview: 0,
      requeued: 0,
      failed: 0,
      imagesCopied: 0,
      error: null,
      details: [],
    };
    summaries.push(summary);

    const pushDetail = (detail: AutopilotTenantSummary["details"][number]) => {
      if (summary.details.length < MAX_DETAILS) summary.details.push(detail);
    };

    const { data: runId, error: beginError } = await admin.rpc("begin_product_enrichment_run", {
      p_tenant_id: tenantId,
      p_trigger: options.trigger,
    });
    if (beginError) {
      summary.error = beginError.message;
      continue;
    }
    if (!runId) {
      summary.skipped = true;
      continue;
    }
    summary.runId = runId as string;

    try {
      const { data: enqueued, error: enqueueError } = await admin.rpc("enqueue_product_enrichment_auto", {
        p_tenant_id: tenantId,
        p_limit: ENQUEUE_LIMIT,
      });
      if (enqueueError) throw new Error(enqueueError.message);
      summary.enqueued = Number(enqueued ?? 0);

      const { data: claimedRows, error: claimError } = await admin.rpc("claim_product_enrichment_jobs", {
        p_tenant_id: tenantId,
        p_limit: CLAIM_LIMIT,
      });
      if (claimError) throw new Error(claimError.message);
      const jobIds = ((claimedRows ?? []) as Array<{ job_id: string }>).map((row) => row.job_id);
      summary.claimed = jobIds.length;

      let results: EngineJobResult[] = [];
      if (jobIds.length) {
        const engine = await invokeEdgeFunction<{ ok?: boolean; results?: EngineJobResult[] }>(
          "process-manufacturer-enrichment",
          { jobIds },
          ENGINE_TIMEOUT_MS,
        );
        results = engine.results ?? [];
      }
      summary.processed = results.length;

      for (const result of results) {
        if (result.status === "failed" || result.status === "skipped") {
          summary.failed += 1;
          pushDetail({ jobId: result.jobId, status: result.status, reason: result.reason });
          continue;
        }
        if (result.status === "requeued") {
          summary.requeued += 1;
          pushDetail({ jobId: result.jobId, status: "requeued", reason: result.reason });
          continue;
        }
        if (result.status !== "review") continue;

        const { data: candidate } = await admin
          .from("product_enrichment_candidates")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("job_id", result.jobId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!candidate?.id) {
          summary.sentReview += 1;
          pushDetail({ jobId: result.jobId, status: "review", reason: "Sugestão pendente não localizada" });
          continue;
        }

        const { data: dryRaw, error: dryError } = await admin.rpc("auto_approve_product_enrichment_candidate", {
          p_candidate_id: candidate.id,
          p_dry_run: true,
        });
        if (dryError) {
          summary.sentReview += 1;
          pushDetail({ jobId: result.jobId, candidateId: candidate.id, status: "review", reason: dryError.message });
          continue;
        }
        const dry = (dryRaw ?? {}) as AutoApproveOutcome;
        if (!dry.eligible) {
          summary.sentReview += 1;
          pushDetail({ jobId: result.jobId, candidateId: candidate.id, status: "review", reason: dry.reason });
          continue;
        }

        if (dry.needs_image_copy) {
          try {
            const copy = await invokeEdgeFunction<{ ok?: boolean; copied?: number; error?: string }>(
              "copy-product-enrichment-image",
              { candidateId: candidate.id },
              COPY_TIMEOUT_MS,
            );
            if (!copy.ok) throw new Error(copy.error ?? "Não foi possível copiar a galeria");
            summary.imagesCopied += Number(copy.copied ?? 0);
          } catch (copyError) {
            summary.sentReview += 1;
            pushDetail({
              jobId: result.jobId,
              candidateId: candidate.id,
              status: "review",
              reason: `Cópia de imagens falhou: ${copyError instanceof Error ? copyError.message : "erro"}`,
            });
            continue;
          }
        }

        const { data: finalRaw, error: finalError } = await admin.rpc("auto_approve_product_enrichment_candidate", {
          p_candidate_id: candidate.id,
          p_dry_run: false,
        });
        if (finalError) {
          summary.sentReview += 1;
          pushDetail({ jobId: result.jobId, candidateId: candidate.id, status: "review", reason: finalError.message });
          continue;
        }
        const final = (finalRaw ?? {}) as AutoApproveOutcome;
        if (final.eligible) {
          summary.autoApproved += 1;
          pushDetail({ jobId: result.jobId, candidateId: candidate.id, status: "auto_approved" });
        } else {
          summary.sentReview += 1;
          pushDetail({ jobId: result.jobId, candidateId: candidate.id, status: "review", reason: final.reason });
        }
      }

      await admin.rpc("finish_product_enrichment_run", {
        p_run_id: summary.runId,
        p_status: "completed",
        p_enqueued: summary.enqueued,
        p_claimed: summary.claimed,
        p_processed: summary.processed,
        p_auto_approved: summary.autoApproved,
        p_sent_review: summary.sentReview,
        p_failed: summary.failed,
        p_images_copied: summary.imagesCopied,
        p_last_error: null,
        p_details: summary.details,
      });
    } catch (error) {
      summary.error = error instanceof Error ? error.message : "Falha inesperada no worker";
      await admin
        .rpc("finish_product_enrichment_run", {
          p_run_id: summary.runId,
          p_status: "failed",
          p_enqueued: summary.enqueued,
          p_claimed: summary.claimed,
          p_processed: summary.processed,
          p_auto_approved: summary.autoApproved,
          p_sent_review: summary.sentReview,
          p_failed: summary.failed,
          p_images_copied: summary.imagesCopied,
          p_last_error: summary.error,
          p_details: summary.details,
        })
        .then(() => undefined, () => undefined);
    }
  }

  return {
    ok: summaries.every((summary) => !summary.error),
    trigger: options.trigger,
    startedAt,
    finishedAt: new Date().toISOString(),
    tenants: summaries,
  };
}
