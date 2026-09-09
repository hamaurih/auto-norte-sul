import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";
import { decryptIntegrationSecret } from "@/lib/integration-crypto.server";

const BLING_API = "https://api.bling.com.br/Api/v3";
const BLING_TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";
const PAGE_LIMIT = 100;
const MIN_INTERVAL_MS = 450;

let rateChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

type SupplierLink = {
  id: string | number | null;
  supplier_id: string | number | null;
  standard: boolean;
  cost_price: number | null;
  purchase_price: number | null;
};

async function requireCostRecoveryAdmin(context: any) {
  await requireTenantRole(context.supabase, context.userId, context.tenantId, ["owner", "admin"]);
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function getBlingConfig(admin: any, tenantId: string) {
  const { data, error } = await admin
    .from("bling_config")
    .select("id,tenant_id,active,client_id,client_secret_encrypted,access_token,refresh_token,expires_at,last_cost_sync_page,last_cost_sync_at,last_cost_sync_status,last_cost_sync_message,last_cost_sync_cycle_token")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Configuração do Bling não encontrada para esta empresa.");
  return data as any;
}

async function getBlingCredentials(cfg: any) {
  const clientId = String(cfg.client_id || process.env.BLING_CLIENT_ID || "").trim();
  let clientSecret = String(process.env.BLING_CLIENT_SECRET || "").trim();
  if (cfg.client_secret_encrypted) clientSecret = await decryptIntegrationSecret(cfg.client_secret_encrypted);
  return { clientId, clientSecret };
}

async function refreshTokenIfNeeded(admin: any, tenantId: string) {
  const cfg = await getBlingConfig(admin, tenantId);
  if (!cfg.active) throw new Error("A integração com o Bling está desativada.");
  if (!cfg.access_token) throw new Error("Bling sem access token. Reautorize a integração.");

  const expiresAt = cfg.expires_at ? new Date(cfg.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return { token: String(cfg.access_token), cfg };
  if (!cfg.refresh_token) throw new Error("Token do Bling expirado e sem refresh token. Reautorize a integração.");

  const { clientId, clientSecret } = await getBlingCredentials(cfg);
  if (!clientId || !clientSecret) throw new Error("Client ID/Client Secret do Bling não estão configurados no backend.");

  const response = await fetch(BLING_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      Accept: "1.0",
      "enable-jwt": "1",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(cfg.refresh_token),
    }).toString(),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`Falha ao renovar token do Bling (HTTP ${response.status}).`);

  const nextExpiresAt = new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString();
  const { error } = await admin
    .from("bling_config")
    .update({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token ?? cfg.refresh_token,
      expires_at: nextExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", cfg.id);
  if (error) throw new Error(error.message);
  return {
    token: String(payload.access_token),
    cfg: {
      ...cfg,
      access_token: payload.access_token,
      refresh_token: payload.refresh_token ?? cfg.refresh_token,
      expires_at: nextExpiresAt,
    },
  };
}

async function rateLimitedFetch(token: string, path: string) {
  const scheduled = rateChain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  rateChain = scheduled.catch(() => undefined);
  await scheduled;

  let response = await fetch(`${BLING_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "enable-jwt": "1" },
  });
  if (response.status === 429) {
    await sleep(1500);
    response = await fetch(`${BLING_API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "enable-jwt": "1" },
    });
  }
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Bling ${path} → HTTP ${response.status}`);
  return payload;
}

function positive(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeSupplierLink(row: any): SupplierLink {
  return {
    id: row?.id ?? null,
    supplier_id: row?.supplier_id ?? row?.fornecedor?.id ?? null,
    standard: row?.standard === true || row?.padrao === true,
    cost_price: positive(row?.cost_price ?? row?.precoCusto),
    purchase_price: positive(row?.purchase_price ?? row?.precoCompra),
  };
}

function effectiveCost(row: SupplierLink) {
  return positive(row.cost_price) ?? positive(row.purchase_price);
}

function supplierLinkKey(row: SupplierLink) {
  if (row.id !== null && row.id !== undefined) return `id:${String(row.id)}`;
  return [row.supplier_id ?? "", row.standard ? "1" : "0", row.cost_price ?? "", row.purchase_price ?? ""].join("|");
}

function mergeSupplierLinks(previous: unknown, current: SupplierLink[]) {
  const rows = [
    ...(Array.isArray(previous) ? previous.map(normalizeSupplierLink) : []),
    ...current.map(normalizeSupplierLink),
  ];
  const merged = new Map<string, SupplierLink>();
  for (const row of rows) merged.set(supplierLinkKey(row), row);
  return [...merged.values()];
}

function allSameCost(rows: SupplierLink[]) {
  const costs = rows.map(effectiveCost).filter((v): v is number => v !== null);
  if (!costs.length) return false;
  return Math.max(...costs) - Math.min(...costs) <= 0.01;
}

function chooseSupplierCost(rows: SupplierLink[]) {
  const positives = rows.filter((row) => effectiveCost(row) !== null);
  const standards = positives.filter((row) => row.standard === true);
  let selected: SupplierLink | null = null;
  let confidence: "high" | "medium" | "low" = "low";
  let reason = "Sem custo positivo no vínculo de fornecedor";

  if (standards.length === 1) {
    selected = standards[0];
    confidence = positive(selected.cost_price) !== null ? "high" : "medium";
    reason = "Fornecedor padrão do Bling";
  } else if (standards.length > 1 && allSameCost(standards)) {
    selected = standards[0];
    confidence = "medium";
    reason = "Múltiplos vínculos padrão com o mesmo custo";
  } else if (standards.length > 1) {
    reason = "Múltiplos fornecedores padrão com custos divergentes; revisão manual necessária";
  } else if (positives.length === 1) {
    selected = positives[0];
    confidence = "medium";
    reason = "Único vínculo de fornecedor com custo positivo";
  } else if (positives.length > 1 && allSameCost(positives)) {
    selected = positives[0];
    confidence = "medium";
    reason = "Fornecedores distintos com o mesmo custo";
  } else if (positives.length > 1) {
    reason = "Múltiplos fornecedores com custos divergentes; revisão manual necessária";
  }

  return {
    cost: selected ? effectiveCost(selected) : null,
    selected,
    confidence,
    reason,
    ambiguous: !selected && positives.length > 1,
  };
}

async function writeSummaryLog(
  admin: any,
  tenantId: string,
  payload: Record<string, unknown>,
  message: string,
  status: "sucesso" | "erro" = "sucesso",
) {
  await admin.from("bling_sync_logs").insert({
    tenant_id: tenantId,
    entity: "produto",
    entity_id: null,
    action: "cost_recovery",
    status,
    message: message.slice(0, 400),
    payload,
  });
}

export const getBlingCostRecoveryStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireCostRecoveryAdmin(context);
    const admin = await getAdmin();
    const cfg = await getBlingConfig(admin, context.tenantId);
    const [totalResult, costResult, pendingResult, awaitingResult] = await Promise.all([
      admin.from("products").select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId).eq("active", true).is("deleted_at", null),
      admin.from("products").select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId).eq("active", true).is("deleted_at", null).gt("average_cost", 0),
      admin.from("product_cost_candidates").select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId).eq("source_type", "bling").eq("status", "pending"),
      admin.from("product_cost_candidates").select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId).eq("source_type", "bling").eq("status", "awaiting_source"),
    ]);
    for (const result of [totalResult, costResult, pendingResult, awaitingResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    const total = Number(totalResult.count ?? 0);
    const withCost = Number(costResult.count ?? 0);
    return {
      totalProducts: total,
      withCost,
      missingCost: Math.max(0, total - withCost),
      pendingBling: Number(pendingResult.count ?? 0),
      ambiguousBling: Number(awaitingResult.count ?? 0),
      nextPage: Number(cfg.last_cost_sync_page ?? 1),
      lastSyncAt: cfg.last_cost_sync_at ?? null,
      lastStatus: cfg.last_cost_sync_status ?? null,
      lastMessage: cfg.last_cost_sync_message ?? null,
      connected: Boolean(cfg.access_token && cfg.refresh_token),
      tokenExpired: cfg.expires_at ? new Date(cfg.expires_at).getTime() <= Date.now() : true,
    };
  });

export const syncBlingCostRecoveryBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { maxPages?: number; reset?: boolean }) => input ?? {})
  .handler(async ({ data, context }) => {
    await requireCostRecoveryAdmin(context);
    const admin = await getAdmin();
    const { token, cfg } = await refreshTokenIfNeeded(admin, context.tenantId);
    const maxPages = Math.max(1, Math.min(Math.trunc(Number(data.maxPages ?? 5)), 10));
    let page = data.reset ? 1 : Math.max(1, Number(cfg.last_cost_sync_page ?? 1));
    let cycleToken = String(cfg.last_cost_sync_cycle_token ?? "");
    if (data.reset || page === 1 || !cycleToken) {
      cycleToken = crypto.randomUUID();
      const { error: cycleError } = await admin.from("bling_config").update({
        last_cost_sync_page: 1,
        last_cost_sync_cycle_token: cycleToken,
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", context.tenantId).eq("id", cfg.id);
      if (cycleError) throw new Error(cycleError.message);
      page = 1;
    }

    let cycleCompleted = false;
    let linksRead = 0;
    let matchedProducts = 0;
    let candidatesCreated = 0;
    let candidatesUpdated = 0;
    let ambiguous = 0;
    let protectedExisting = 0;
    let alreadyCosted = 0;
    let pagesProcessed = 0;

    try {
      for (let index = 0; index < maxPages; index += 1) {
        const payload = await rateLimitedFetch(token, `/produtos/fornecedores?pagina=${page}&limite=${PAGE_LIMIT}`);
        const rows: any[] = Array.isArray(payload?.data) ? payload.data : [];
        if (!rows.length) {
          cycleCompleted = true;
          page = 1;
          break;
        }
        pagesProcessed += 1;
        linksRead += rows.length;

        const grouped = new Map<string, SupplierLink[]>();
        for (const row of rows) {
          const blingProductId = String(row?.produto?.id ?? "").trim();
          if (!blingProductId) continue;
          const current = grouped.get(blingProductId) ?? [];
          current.push(normalizeSupplierLink(row));
          grouped.set(blingProductId, current);
        }
        const blingIds = [...grouped.keys()];
        if (blingIds.length) {
          const { data: localProducts, error: productError } = await admin
            .from("products")
            .select("id,bling_id,name,average_cost,last_purchase_cost,price_b2c")
            .eq("tenant_id", context.tenantId)
            .eq("active", true)
            .is("deleted_at", null)
            .in("bling_id", blingIds);
          if (productError) throw new Error(productError.message);
          const local = localProducts ?? [];
          matchedProducts += local.length;
          const missingProducts = local.filter((product: any) => !(Number(product.average_cost ?? 0) > 0));
          alreadyCosted += local.length - missingProducts.length;
          const productIds = missingProducts.map((product: any) => product.id);
          const { data: openCandidates, error: candidateError } = productIds.length
            ? await admin.from("product_cost_candidates")
                .select("id,product_id,source_type,status,evidence,created_by")
                .eq("tenant_id", context.tenantId)
                .in("product_id", productIds)
                .in("status", ["awaiting_source", "pending"])
            : { data: [], error: null };
          if (candidateError) throw new Error(candidateError.message);
          const openMap = new Map((openCandidates ?? []).map((candidate: any) => [candidate.product_id, candidate]));
          const inserts: any[] = [];
          const updates: Array<{ id: string; payload: any }> = [];

          for (const product of missingProducts) {
            const existing: any = openMap.get(product.id);
            if (existing && ["manual", "nfe_xml", "goods_receipt", "purchase_order"].includes(existing.source_type)) {
              protectedExisting += 1;
              continue;
            }

            const pageLinks = grouped.get(String(product.bling_id)) ?? [];
            const sameCycle = existing?.source_type === "bling" && String(existing?.evidence?.cycle_token ?? "") === cycleToken;
            const relationRows = mergeSupplierLinks(sameCycle ? existing?.evidence?.supplier_links : [], pageLinks);
            const choice = chooseSupplierCost(relationRows);
            if (choice.ambiguous) ambiguous += 1;
            const selected = choice.selected;
            const cost = choice.cost;
            const currentPrice = Number(product.price_b2c ?? 0);
            const candidatePayload = {
              tenant_id: context.tenantId,
              product_id: product.id,
              proposed_cost: cost,
              source_type: "bling",
              source_reference: selected
                ? `Bling produto-fornecedor #${String(selected.id ?? "s/id")} · fornecedor #${String(selected.supplier_id ?? "s/id")}`
                : `Bling · ${choice.reason}`,
              source_date: new Date().toISOString(),
              confidence: choice.confidence,
              status: cost ? "pending" : "awaiting_source",
              evidence: {
                source: "bling_api_v3_produtos_fornecedores",
                bling_product_id: String(product.bling_id),
                cycle_token: cycleToken,
                reason: choice.reason,
                selected_relationship_id: selected?.id ?? null,
                supplier_links: relationRows,
              },
              notes: choice.ambiguous ? "Revisar vínculos de fornecedor no Bling ou informar custo manual com evidência." : null,
              current_price: currentPrice || null,
              suggested_price: null,
              projected_margin_rate: cost && currentPrice > 0 ? Number(((currentPrice - cost) / currentPrice).toFixed(6)) : null,
              updated_at: new Date().toISOString(),
            };
            if (existing) updates.push({ id: existing.id, payload: candidatePayload });
            else inserts.push({ ...candidatePayload, created_by: context.userId });
          }

          if (inserts.length) {
            const { error } = await admin.from("product_cost_candidates").insert(inserts);
            if (error) throw new Error(error.message);
            candidatesCreated += inserts.length;
          }
          if (updates.length) {
            const results = await Promise.all(updates.map(({ id, payload }) =>
              admin.from("product_cost_candidates")
                .update(payload)
                .eq("tenant_id", context.tenantId)
                .eq("id", id),
            ));
            const failed = results.find((result: any) => result.error);
            if (failed?.error) throw new Error(failed.error.message);
            candidatesUpdated += updates.length;
          }
        }

        page += 1;
        if (rows.length < PAGE_LIMIT) {
          cycleCompleted = true;
          page = 1;
          break;
        }
      }

      const message = cycleCompleted
        ? `Ciclo do Bling concluído: ${linksRead} vínculos lidos neste lote; custos aguardam aprovação gerencial.`
        : `Lote concluído até a página ${page - 1}; continuação preparada na página ${page}.`;
      const now = new Date().toISOString();
      const { error: configError } = await admin.from("bling_config").update({
        last_cost_sync_page: page,
        last_cost_sync_at: now,
        last_cost_sync_status: "sucesso",
        last_cost_sync_message: message,
        last_cost_sync_cycle_token: cycleToken,
        updated_at: now,
      }).eq("tenant_id", context.tenantId).eq("id", cfg.id);
      if (configError) throw new Error(configError.message);
      await writeSummaryLog(admin, context.tenantId, {
        cycleToken,
        pagesProcessed,
        linksRead,
        matchedProducts,
        candidatesCreated,
        candidatesUpdated,
        ambiguous,
        protectedExisting,
        alreadyCosted,
        cycleCompleted,
        nextPage: page,
      }, message);
      return {
        ok: true,
        pagesProcessed,
        linksRead,
        matchedProducts,
        candidatesCreated,
        candidatesUpdated,
        ambiguous,
        protectedExisting,
        alreadyCosted,
        cycleCompleted,
        nextPage: page,
        message,
      };
    } catch (error: any) {
      const message = String(error?.message ?? error);
      const now = new Date().toISOString();
      await admin.from("bling_config").update({
        last_cost_sync_page: page,
        last_cost_sync_at: now,
        last_cost_sync_status: "erro",
        last_cost_sync_message: message.slice(0, 400),
        last_cost_sync_cycle_token: cycleToken,
        updated_at: now,
      }).eq("tenant_id", context.tenantId).eq("id", cfg.id);
      await writeSummaryLog(admin, context.tenantId, { cycleToken, page, pagesProcessed, linksRead }, message, "erro").catch(() => undefined);
      throw error;
    }
  });
