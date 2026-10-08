import { tdb } from "@/integrations/supabase/tenant-db";

const CLAIM_LIMIT = 2;
const ENGINE_TIMEOUT_MS = 235_000;
const MAX_TENANTS_PER_TICK = 5;
const OFFICIAL_SUPABASE_URL = "https://pzwjbitjersngordgcsh.supabase.co";
const ADMIN_BRIDGE_URL = `${OFFICIAL_SUPABASE_URL}/functions/v1/server-admin-bridge`;

type EngineResult = {
  jobId: string;
  candidateId?: string;
  status: string;
  reason?: string;
  sourceName?: string;
};

export type ShippingEnrichmentAutopilotResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  tenants: Array<{
    tenantId: string;
    claimed: number;
    processed: number;
    review: number;
    requeued: number;
    failed: number;
    error: string | null;
    details: EngineResult[];
  }>;
};

function bridgeCredential() {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["AUTH_RATE_LIMIT_PEPPER"];
  if (!key || key.length < 32) throw new Error("Credencial server-only da ponte oficial não configurada");
  return key;
}

async function invokeShippingEngine(jobIds: string[]) {
  const key = bridgeCredential();
  const response = await fetch(ADMIN_BRIDGE_URL, {
    method: "POST",
    headers: {
      "x-cutover-key": key,
      "x-proxy-path": "/functions/v1/process-shipping-enrichment",
      "x-proxy-method": "POST",
      "x-forward-content-type": "application/json",
      "x-forward-accept": "application/json",
    },
    body: JSON.stringify({ jobIds }),
    signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; results?: EngineResult[]; error?: string } | null;
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? `Worker de peso/medidas respondeu ${response.status}`);
  return body.results ?? [];
}

export async function runShippingEnrichmentAutopilot(): Promise<ShippingEnrichmentAutopilotResult> {
  const startedAt = new Date().toISOString();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = tdb(supabaseAdmin) as any;

  const { data: queuedRows, error: queuedError } = await admin
    .from("product_enrichment_jobs")
    .select("tenant_id")
    .eq("status", "queued")
    .like("search_query", "[shipping]%")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(100);
  if (queuedError) throw new Error(queuedError.message);

  const tenantIds = [...new Set((queuedRows ?? []).map((row: { tenant_id: string }) => row.tenant_id))]
    .slice(0, MAX_TENANTS_PER_TICK) as string[];
  const tenants: ShippingEnrichmentAutopilotResult["tenants"] = [];

  for (const tenantId of tenantIds) {
    const summary = {
      tenantId,
      claimed: 0,
      processed: 0,
      review: 0,
      requeued: 0,
      failed: 0,
      error: null as string | null,
      details: [] as EngineResult[],
    };
    tenants.push(summary);
    try {
      const { data: claimed, error: claimError } = await admin.rpc("claim_shipping_enrichment_jobs", {
        p_tenant_id: tenantId,
        p_limit: CLAIM_LIMIT,
      });
      if (claimError) throw new Error(claimError.message);
      const jobIds = (claimed ?? []).map((row: { job_id: string }) => row.job_id);
      summary.claimed = jobIds.length;
      if (!jobIds.length) continue;

      const results = await invokeShippingEngine(jobIds);
      summary.processed = results.length;
      summary.details = results.slice(0, 10);
      for (const result of results) {
        if (result.status === "review") summary.review += 1;
        else if (result.status === "requeued") summary.requeued += 1;
        else if (result.status === "failed" || result.status === "skipped") summary.failed += 1;
      }
    } catch (error) {
      summary.error = error instanceof Error ? error.message : "Falha inesperada no worker de peso/medidas";
    }
  }

  return {
    ok: tenants.every((tenant) => !tenant.error),
    startedAt,
    finishedAt: new Date().toISOString(),
    tenants,
  };
}
