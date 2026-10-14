import { getBlingCredentials } from "./bling.functions";

const BLING_API = "https://api.bling.com.br/Api/v3";
const TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";
const STOCK_PULL_LIMIT = 500;
const STOCK_API_BATCH = 50;
const REQUEST_INTERVAL_MS = 450;
let lastRequestAt = 0;
let rateChain: Promise<void> = Promise.resolve();

type BlingConfig = {
  id: string;
  tenant_id: string;
  active: boolean;
  sync_stock: boolean;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  client_id: string | null;
  client_secret_encrypted: string | null;
  last_stock_sync_product_id: string | null;
};

type StockPayload = {
  produto?: { id?: number | string };
  saldoFisicoTotal?: number | string;
  saldoVirtualTotal?: number | string;
};

export type BlingStockPullResult = {
  ok: boolean;
  tenants: Array<{
    tenantId: string;
    scanned: number;
    updated: number;
    missing: number;
    errors: number;
    cycleCompleted: boolean;
    error: string | null;
  }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const finiteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function rateLimited<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = rateChain.then(async () => {
    const wait = REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  rateChain = scheduled.catch(() => undefined);
  return scheduled.then(task);
}

async function refreshToken(admin: any, cfg: BlingConfig) {
  if (!cfg.active) throw new Error("Integração Bling inativa");
  if (!cfg.access_token) throw new Error("Bling sem access_token");
  const expiresAt = cfg.expires_at ? new Date(cfg.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return cfg.access_token;
  if (!cfg.refresh_token) throw new Error("Token Bling expirado e sem refresh_token");

  const credentials = await getBlingCredentials(admin, cfg.tenant_id, cfg);
  if (!credentials.clientId || !credentials.clientSecret) throw new Error("Credenciais OAuth do Bling não configuradas");
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, "utf8").toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
      accept: "1.0",
      "enable-jwt": "1",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refresh_token }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as any;
  if (!response.ok || !body?.access_token) throw new Error(`Falha ao renovar token Bling (HTTP ${response.status})`);

  const expires = new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString();
  const { error } = await admin.from("bling_config").update({
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? cfg.refresh_token,
    expires_at: expires,
    updated_at: new Date().toISOString(),
  }).eq("id", cfg.id).eq("tenant_id", cfg.tenant_id);
  if (error) throw new Error(error.message);
  cfg.access_token = String(body.access_token);
  cfg.refresh_token = String(body.refresh_token ?? cfg.refresh_token);
  cfg.expires_at = expires;
  return cfg.access_token;
}

async function blingGet(token: string, path: string) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await rateLimited(() => fetch(`${BLING_API}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "enable-jwt": "1",
      },
      signal: AbortSignal.timeout(20_000),
    }));
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`Bling GET ${path}: HTTP ${response.status}`);
      if (attempt < 3) {
        const retry = Number(response.headers.get("retry-after") ?? 0);
        await sleep(retry > 0 ? Math.min(retry * 1000, 30_000) : 1000 * 2 ** attempt);
        continue;
      }
    }
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) throw new Error(`Bling GET ${path}: HTTP ${response.status} — ${String(body?.message ?? body?.error?.message ?? "erro")}`);
    return body?.data ?? body;
  }
  throw lastError ?? new Error(`Falha ao consultar ${path}`);
}

async function defaultOnlineWarehouse(admin: any, tenantId: string) {
  const { data, error } = await admin
    .from("warehouses")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("available_for_online", true)
    .eq("inventory_kind", "regular")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Depósito online regular não configurado");
  return String(data.id);
}

async function writeStockAudit(admin: any, tenantId: string, productId: string, warehouseId: string, delta: number, reference: string) {
  if (!delta) return;
  await admin.from("stock_movements").insert({
    tenant_id: tenantId,
    product_id: productId,
    warehouse_id: warehouseId,
    type: "ADJUST",
    qty: Math.abs(delta),
    reference: reference.slice(0, 200),
    notes: `Reconciliação automática de estoque com Bling. Variação: ${delta > 0 ? "+" : ""}${delta}.`,
  }).then(() => undefined, () => undefined);
}

export async function applyBlingPhysicalStock(
  admin: any,
  tenantId: string,
  blingProductId: string,
  physicalTotal: number,
  reference: string,
) {
  const normalized = Math.max(0, Math.floor(physicalTotal));
  const { data: product, error: productError } = await admin
    .from("products")
    .select("id,bling_id")
    .eq("tenant_id", tenantId)
    .eq("bling_id", blingProductId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (productError) throw new Error(productError.message);
  if (!product?.id) return { status: "missing" as const };

  const warehouseId = await defaultOnlineWarehouse(admin, tenantId);
  const { data: current, error: currentError } = await admin
    .from("product_stock")
    .select("id,on_hand,reserved,min_stock")
    .eq("tenant_id", tenantId)
    .eq("product_id", product.id)
    .eq("warehouse_id", warehouseId)
    .maybeSingle();
  if (currentError) throw new Error(currentError.message);

  const previous = Number(current?.on_hand ?? 0);
  const reserved = Math.max(0, Number(current?.reserved ?? 0));
  if (current?.id) {
    const { error } = await admin.from("product_stock").update({
      on_hand: normalized,
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId).eq("id", current.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("product_stock").insert({
      tenant_id: tenantId,
      product_id: product.id,
      warehouse_id: warehouseId,
      on_hand: normalized,
      reserved: 0,
      min_stock: 0,
    });
    if (error) throw new Error(error.message);
  }

  await writeStockAudit(admin, tenantId, product.id, warehouseId, normalized - previous, reference);
  return {
    status: "updated" as const,
    productId: String(product.id),
    previous,
    onHand: normalized,
    reserved,
    available: Math.max(normalized - reserved, 0),
  };
}

async function verifySignatureForTenant(admin: any, raw: string, signature: string) {
  const normalizedSignature = signature.trim().toLowerCase();
  if (!/^sha256=[0-9a-f]{64}$/.test(normalizedSignature)) return null;
  const signatureHex = normalizedSignature.slice("sha256=".length);
  const { createHmac, timingSafeEqual } = await import("node:crypto");

  const { data: configs, error } = await admin
    .from("bling_config")
    .select("id,tenant_id,client_id,client_secret_encrypted,active")
    .eq("active", true);
  if (error) throw new Error(error.message);

  for (const cfg of configs ?? []) {
    try {
      const credentials = await getBlingCredentials(admin, cfg.tenant_id, cfg);
      if (!credentials.clientSecret) continue;
      const expectedHex = createHmac("sha256", credentials.clientSecret).update(raw, "utf8").digest("hex");
      const expected = Buffer.from(expectedHex, "hex");
      const provided = Buffer.from(signatureHex, "hex");
      if (expected.length === provided.length && timingSafeEqual(expected, provided)) return String(cfg.tenant_id);
    } catch {
      // Continua tentando as demais configurações sem expor segredo ou detalhes.
    }
  }
  return null;
}

export async function receiveBlingWebhook(raw: string, signature: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  const tenantId = await verifySignatureForTenant(admin, raw, signature);
  if (!tenantId) return { ok: false, status: 401, message: "Assinatura Bling inválida" };

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return { ok: false, status: 400, message: "JSON inválido" }; }
  const eventId = String(payload?.eventId ?? "").trim();
  const eventName = String(payload?.event ?? "").trim();
  if (!eventId || !eventName) return { ok: false, status: 400, message: "Webhook Bling sem eventId/event" };

  const { data: existing } = await admin.from("bling_webhook_events").select("event_id,status").eq("event_id", eventId).maybeSingle();
  if (existing?.event_id) return { ok: true, status: 200, duplicate: true, eventId, eventName };

  const { error: insertError } = await admin.from("bling_webhook_events").insert({
    event_id: eventId,
    tenant_id: tenantId,
    event_name: eventName,
    payload,
    status: "received",
  });
  if (insertError) throw new Error(insertError.message);

  if (!/^stock\.(created|updated|deleted)$/.test(eventName)) {
    await admin.from("bling_webhook_events").update({ status: "ignored", processed_at: new Date().toISOString() }).eq("event_id", eventId);
    return { ok: true, status: 200, ignored: true, eventId, eventName };
  }

  try {
    const data = payload?.data as StockPayload;
    const blingProductId = String(data?.produto?.id ?? "").trim();
    const physical = finiteNumber(data?.saldoFisicoTotal);
    if (!blingProductId || physical == null) throw new Error("Webhook de estoque sem produto/saldo físico total");
    const applied = await applyBlingPhysicalStock(admin, tenantId, blingProductId, physical, `BLING-WEBHOOK-${eventId}`);
    await admin.from("bling_webhook_events").update({
      status: applied.status === "missing" ? "ignored" : "processed",
      last_error: null,
      processed_at: new Date().toISOString(),
    }).eq("event_id", eventId);
    return { ok: true, status: 200, eventId, eventName, applied: applied.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao processar estoque Bling";
    await admin.from("bling_webhook_events").update({ status: "error", last_error: message.slice(0, 1500) }).eq("event_id", eventId);
    // Retorna erro para que o Bling execute sua política de retentativa.
    return { ok: false, status: 503, message };
  }
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function pullTenantStock(admin: any, cfg: BlingConfig) {
  const summary = {
    tenantId: cfg.tenant_id,
    scanned: 0,
    updated: 0,
    missing: 0,
    errors: 0,
    cycleCompleted: false,
    error: null as string | null,
  };
  try {
    const token = await refreshToken(admin, cfg);
    let query = admin
      .from("products")
      .select("id,bling_id")
      .eq("tenant_id", cfg.tenant_id)
      .not("bling_id", "is", null)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .limit(STOCK_PULL_LIMIT);
    if (cfg.last_stock_sync_product_id) query = query.gt("id", cfg.last_stock_sync_product_id);
    const { data: products, error: productError } = await query;
    if (productError) throw new Error(productError.message);

    const rows = (products ?? []).filter((row: any) => /^\d+$/.test(String(row.bling_id ?? "")));
    summary.scanned = rows.length;
    if (!rows.length) {
      await admin.from("bling_config").update({ last_stock_sync_product_id: null, last_stock_sync_at: new Date().toISOString() }).eq("tenant_id", cfg.tenant_id).eq("id", cfg.id);
      summary.cycleCompleted = true;
      return summary;
    }

    const localByBling = new Map(rows.map((row: any) => [String(row.bling_id), String(row.id)]));
    for (const batch of chunks(rows, STOCK_API_BATCH)) {
      const params = new URLSearchParams();
      for (const row of batch) params.append("idsProdutos[]", String(row.bling_id));
      const balances = await blingGet(token, `/estoques/saldos?${params.toString()}`);
      const returned = Array.isArray(balances) ? balances : [];
      const seen = new Set<string>();
      for (const balance of returned) {
        const blingId = String(balance?.produto?.id ?? "").trim();
        if (!blingId || !localByBling.has(blingId)) continue;
        seen.add(blingId);
        const physical = finiteNumber(balance?.saldoFisicoTotal);
        if (physical == null) { summary.errors += 1; continue; }
        try {
          const applied = await applyBlingPhysicalStock(admin, cfg.tenant_id, blingId, physical, `BLING-STOCK-PULL-${new Date().toISOString()}`);
          if (applied.status === "updated") summary.updated += 1;
          else summary.missing += 1;
        } catch {
          summary.errors += 1;
        }
      }
      summary.missing += batch.filter((row: any) => !seen.has(String(row.bling_id))).length;
    }

    const lastId = String(rows[rows.length - 1].id);
    const cycleCompleted = rows.length < STOCK_PULL_LIMIT;
    await admin.from("bling_config").update({
      last_stock_sync_product_id: cycleCompleted ? null : lastId,
      last_stock_sync_at: new Date().toISOString(),
    }).eq("tenant_id", cfg.tenant_id).eq("id", cfg.id);
    summary.cycleCompleted = cycleCompleted;
    return summary;
  } catch (error) {
    summary.error = error instanceof Error ? error.message : "Falha na reconciliação de estoque Bling";
    return summary;
  }
}

export async function runBlingStockPull(): Promise<BlingStockPullResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  const { data: configs, error } = await admin
    .from("bling_config")
    .select("id,tenant_id,active,sync_stock,access_token,refresh_token,expires_at,client_id,client_secret_encrypted,last_stock_sync_product_id")
    .eq("active", true)
    .eq("sync_stock", true);
  if (error) throw new Error(error.message);

  const tenants = [];
  for (const config of (configs ?? []) as BlingConfig[]) tenants.push(await pullTenantStock(admin, config));
  return { ok: tenants.every((tenant) => !tenant.error), tenants };
}
