import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";

const BLING_API = "https://www.bling.com.br/Api/v3";
const TOKEN_URL = "https://www.bling.com.br/Api/v3/oauth/token";
const INBOUND_BLOCKED_MESSAGE =
  "Sincronização de entrada desativada: o ERP Norte Sul é a fonte oficial";

type BlingEntity = "produto" | "imagem" | "estoque" | "preco" | "cliente" | "pedido";
type BlingStatus = "pendente" | "sucesso" | "erro";

async function requireBlingAdmin(context: any) {
  await requireTenantRole(context.supabase, context.userId, context.tenantId, ["owner", "admin"]);
}

async function getBlingIntegrationId(sb: any): Promise<string> {
  const { data, error } = await sb.from("integrations").select("id").eq("slug", "bling").maybeSingle();
  if (error || !data?.id) throw new Error(error?.message ?? "Integração Bling não cadastrada.");
  return data.id as string;
}

async function writeLog(
  sb: any,
  tenantId: string,
  args: {
    entity: BlingEntity;
    entity_id?: string | null;
    action: string;
    status?: BlingStatus;
    message?: string;
    payload?: unknown;
    response?: unknown;
    integration_event_id?: string | null;
  },
) {
  const { error } = await sb.from("bling_sync_logs").insert({
    tenant_id: tenantId,
    entity: args.entity,
    entity_id: args.entity_id ?? null,
    action: args.action,
    status: args.status ?? "pendente",
    message: args.message ?? null,
    payload: args.payload ?? null,
    response: args.response ?? null,
    integration_event_id: args.integration_event_id ?? null,
  });
  if (error) throw new Error(error.message);
}

async function getConfig(sb: any, tenantId: string) {
  const { data, error } = await sb
    .from("bling_config")
    .select(
      "id,tenant_id,active,last_authorized_at,last_test_at,last_test_status,expires_at,scope,sync_prices,sync_stock,hide_out_of_stock,image_overwrites_manual,manual_price_overrides,auto_sync,sync_interval_minutes,redirect_uri,access_token,refresh_token",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Configuração Bling não encontrada para este ambiente.");
  return data as any;
}

async function refreshTokenIfNeeded(sb: any, tenantId: string): Promise<string> {
  const cfg = await getConfig(sb, tenantId);
  if (!cfg.access_token) throw new Error("Sem access_token. Conecte o Bling primeiro.");

  const expiresAt = cfg.expires_at ? new Date(cfg.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return cfg.access_token as string;
  if (!cfg.refresh_token) throw new Error("Access token expirado e sem refresh_token. Reautorize o Bling.");

  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Credenciais do Bling não configuradas no backend.");

  const basic = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refresh_token,
    }).toString(),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Falha ao renovar token do Bling (HTTP ${response.status}).`);
  }

  const newExpiresAt = new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString();
  const { error } = await sb
    .from("bling_config")
    .update({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token ?? cfg.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", cfg.id);
  if (error) throw new Error(error.message);
  return payload.access_token as string;
}

async function blingFetch(token: string, path: string) {
  const response = await fetch(`${BLING_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Bling ${path} → HTTP ${response.status}`);
  return payload;
}

async function blockedInbound(context: any, entity: BlingEntity, action: string) {
  await requireBlingAdmin(context);
  await writeLog(context.supabase, context.tenantId, {
    entity,
    action,
    status: "sucesso",
    message: INBOUND_BLOCKED_MESSAGE,
    payload: { mode: "read_only_adapter", source_of_truth: "norte_sul_erp" },
  });
  return {
    ok: false,
    blocked: true,
    message: INBOUND_BLOCKED_MESSAGE,
    sourceOfTruth: "Norte Sul ERP",
  };
}

export const getBlingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireBlingAdmin(context);
    const cfg = await getConfig(context.supabase, context.tenantId);
    const { access_token: _accessToken, refresh_token: _refreshToken, ...safeConfig } = cfg;

    let connectionStatus: "connected" | "disconnected" | "error" | "configuring" = "disconnected";
    if (cfg.last_test_status === "erro") connectionStatus = "error";
    else if (cfg.last_authorized_at && cfg.expires_at && new Date(cfg.expires_at) > new Date()) {
      connectionStatus = "connected";
    } else if (cfg.last_authorized_at) connectionStatus = "configuring";

    return {
      config: safeConfig,
      clientIdConfigured: Boolean(process.env.BLING_CLIENT_ID),
      clientSecretConfigured: Boolean(process.env.BLING_CLIENT_SECRET),
      connectionStatus,
      sourceOfTruth: "Norte Sul ERP",
      adapterMode: true,
    };
  });

export const testBlingConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireBlingAdmin(context);
    const cfg = await getConfig(context.supabase, context.tenantId);
    let status: BlingStatus = "erro";
    let message = "Sem token válido — conecte o Bling primeiro.";
    if (cfg.access_token) {
      try {
        await refreshTokenIfNeeded(context.supabase, context.tenantId);
        status = "sucesso";
        message = "Conexão com Bling válida. Operação em modo conector externo.";
      } catch (error: any) {
        message = String(error?.message ?? error);
      }
    }
    const { error } = await context.supabase
      .from("bling_config")
      .update({ last_test_at: new Date().toISOString(), last_test_status: status, updated_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("id", cfg.id);
    if (error) throw new Error(error.message);
    await writeLog(context.supabase, context.tenantId, {
      entity: "produto",
      action: "test_connection",
      status,
      message,
    });
    return { status, message };
  });

export const revokeBlingConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireBlingAdmin(context);
    const cfg = await getConfig(context.supabase, context.tenantId);
    const { error } = await context.supabase
      .from("bling_config")
      .update({
        access_token: null,
        refresh_token: null,
        expires_at: null,
        last_authorized_at: null,
        last_test_status: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", context.tenantId)
      .eq("id", cfg.id);
    if (error) throw new Error(error.message);
    await writeLog(context.supabase, context.tenantId, {
      entity: "produto",
      action: "revoke",
      status: "sucesso",
      message: "Conexão com Bling revogada.",
    });
    return { ok: true };
  });

export const updateBlingConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    active?: boolean;
    auto_sync?: boolean;
    sync_interval_minutes?: number;
    sync_prices?: boolean;
    sync_stock?: boolean;
    hide_out_of_stock?: boolean;
    image_overwrites_manual?: boolean;
    manual_price_overrides?: boolean;
  }) => input)
  .handler(async ({ data, context }) => {
    await requireBlingAdmin(context);
    const cfg = await getConfig(context.supabase, context.tenantId);
    const { error } = await context.supabase
      .from("bling_config")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("id", cfg.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// The ERP owns core data. These functions intentionally remain exported for UI
// compatibility, but they cannot import or overwrite products, stock, prices or customers.
export const syncBlingProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => blockedInbound(context, "produto", "inbound_products_blocked"));

export const syncBlingStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => blockedInbound(context, "estoque", "inbound_stock_blocked"));

export const syncBlingPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => blockedInbound(context, "preco", "inbound_prices_blocked"));

export const syncBlingCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => blockedInbound(context, "cliente", "inbound_customers_blocked"));

export const syncBlingImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batchSize?: number; onlyMissing?: boolean }) => input)
  .handler(async ({ data, context }) => {
    await requireBlingAdmin(context);
    const sb = context.supabase as any;
    const token = await refreshTokenIfNeeded(sb, context.tenantId);
    const integrationId = await getBlingIntegrationId(sb);
    const batchSize = Math.min(Math.max(data.batchSize ?? 100, 1), 200);

    const { data: mappings, error: mappingsError } = await sb
      .from("external_entity_mappings")
      .select("internal_id,external_id")
      .eq("tenant_id", context.tenantId)
      .eq("integration_id", integrationId)
      .eq("entity_type", "product")
      .limit(batchSize * 3);
    if (mappingsError) throw new Error(mappingsError.message);

    const productIds = (mappings ?? []).map((row: any) => row.internal_id);
    const { data: existingImages } = productIds.length
      ? await sb
          .from("product_images")
          .select("product_id")
          .eq("tenant_id", context.tenantId)
          .in("product_id", productIds)
      : { data: [] };
    const hasImage = new Set((existingImages ?? []).map((row: any) => String(row.product_id)));
    const candidates = (mappings ?? [])
      .filter((row: any) => !data.onlyMissing || !hasImage.has(String(row.internal_id)))
      .slice(0, batchSize);

    let processed = 0;
    let withImages = 0;
    let imagesSaved = 0;
    for (const mapping of candidates) {
      processed += 1;
      try {
        const payload: any = await blingFetch(token, `/produtos/${encodeURIComponent(mapping.external_id)}`);
        const product = payload?.data ?? payload;
        const images: any[] = product?.midia?.imagens?.externas ?? product?.midia?.imagens ?? product?.imagens ?? [];
        const urls = images
          .map((item: any) => String(item?.link ?? item?.url ?? item?.imagemURL ?? "").trim())
          .filter((value: string) => /^https:\/\//i.test(value));
        if (!urls.length) continue;
        withImages += 1;
        if (data.onlyMissing && hasImage.has(String(mapping.internal_id))) continue;

        if (!data.onlyMissing) {
          await sb
            .from("product_images")
            .delete()
            .eq("tenant_id", context.tenantId)
            .eq("product_id", mapping.internal_id);
        }
        const rows = urls.slice(0, 8).map((url: string, index: number) => ({
          tenant_id: context.tenantId,
          product_id: mapping.internal_id,
          url,
          alt: "Imagem do produto",
          sort_order: index,
          is_primary: index === 0,
        }));
        const { error } = await sb.from("product_images").insert(rows);
        if (error) throw new Error(error.message);
        imagesSaved += rows.length;
      } catch (error: any) {
        await writeLog(sb, context.tenantId, {
          entity: "imagem",
          entity_id: mapping.internal_id,
          action: "media_enrichment",
          status: "erro",
          message: String(error?.message ?? error).slice(0, 400),
        });
      }
    }

    const remaining = Math.max((mappings?.length ?? 0) - processed, 0);
    await writeLog(sb, context.tenantId, {
      entity: "imagem",
      action: "media_enrichment_batch",
      status: "sucesso",
      message: `Enriquecimento de mídia: ${processed} verificados, ${imagesSaved} imagens salvas.`,
      payload: { processed, withImages, imagesSaved, remaining },
    });
    return { ok: true, processed, withImages, imagesSaved, remaining };
  });

export const sendPendingOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireBlingAdmin(context);
    const sb = context.supabase as any;
    const integrationId = await getBlingIntegrationId(sb);
    const { data: orders, error } = await sb
      .from("orders")
      .select("id")
      .eq("tenant_id", context.tenantId)
      .is("deleted_at", null)
      .in("status", ["paid", "processing"])
      .limit(100);
    if (error) throw new Error(error.message);

    let queued = 0;
    for (const order of orders ?? []) {
      const idempotencyKey = `order:${order.id}:bling:v1`;
      const { data: event, error: eventError } = await sb
        .from("integration_events")
        .upsert(
          {
            tenant_id: context.tenantId,
            integration_id: integrationId,
            direction: "outbound",
            event_type: "order.export.requested",
            aggregate_type: "order",
            aggregate_id: order.id,
            idempotency_key: idempotencyKey,
            status: "pending",
            payload: { order_id: order.id },
            available_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,integration_id,direction,idempotency_key", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (eventError) throw new Error(eventError.message);
      if (event?.id) {
        queued += 1;
        await writeLog(sb, context.tenantId, {
          entity: "pedido",
          entity_id: order.id,
          action: "queue_outbound",
          status: "pendente",
          message: "Pedido enfileirado para exportação ERP → Bling.",
          integration_event_id: event.id,
        });
      }
    }
    return { ok: true, message: `${queued} pedido(s) enfileirado(s) para exportação ao Bling.`, queued };
  });

export const getBlingStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireBlingAdmin(context);
    const sb = context.supabase as any;
    const countByStatus = async (status?: BlingStatus) => {
      let query = sb
        .from("bling_sync_logs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId);
      if (status) query = query.eq("status", status);
      const { count, error } = await query;
      if (error) throw new Error(error.message);
      return count ?? 0;
    };
    const [total, errors, pending] = await Promise.all([
      countByStatus(),
      countByStatus("erro"),
      countByStatus("pendente"),
    ]);
    return { total, errors, pending };
  });

export const reprocessBlingLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { log_id: string }) => input)
  .handler(async ({ data, context }) => {
    await requireBlingAdmin(context);
    const sb = context.supabase as any;
    const { data: sourceLog, error } = await sb
      .from("bling_sync_logs")
      .select("id,entity,entity_id,action,payload")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.log_id)
      .maybeSingle();
    if (error || !sourceLog) throw new Error(error?.message ?? "Log não encontrado neste ambiente.");

    const integrationId = await getBlingIntegrationId(sb);
    const { data: event, error: eventError } = await sb
      .from("integration_events")
      .upsert(
        {
          tenant_id: context.tenantId,
          integration_id: integrationId,
          direction: "outbound",
          event_type: `bling.retry.${sourceLog.action}`,
          aggregate_type: String(sourceLog.entity),
          aggregate_id: sourceLog.entity_id,
          idempotency_key: `retry:${sourceLog.id}`,
          status: "pending",
          payload: sourceLog.payload ?? {},
          available_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,integration_id,direction,idempotency_key" },
      )
      .select("id")
      .single();
    if (eventError) throw new Error(eventError.message);

    await writeLog(sb, context.tenantId, {
      entity: sourceLog.entity as BlingEntity,
      entity_id: sourceLog.entity_id,
      action: "reprocess_requested",
      status: "pendente",
      message: "Reprocessamento enfileirado pelo ERP Norte Sul.",
      integration_event_id: event.id,
    });
    return { ok: true, event_id: event.id };
  });
