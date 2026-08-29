/**
 * Conector Bling — server functions (Fase 1).
 *
 * INVARIANTE ARQUITETURAL: o ERP Norte Sul é a ÚNICA fonte oficial de produtos,
 * preços, estoque, pedidos e clientes. O Bling é apenas um adaptador
 * externo (conector), sem autoridade sobre dados. Portanto:
 *   - nenhuma sincronização de entrada escreve em products / product_stock /
 *     customers;
 *   - as antigas sincronizações de produtos/estoque/preços/clientes são
 *     bloqueios explícitos com diagnóstico read-only;
 *   - somente o enriquecimento de mídia (imagens) permanece ativo, e ele não
 *     altera nome, SKU, preço, estoque ou situação do produto;
 *   - o fluxo de pedidos é outbound (ERP → Bling), implementado em fase futura.
 *
 * Toda leitura/escrita em `bling_config` e `bling_sync_logs` é escopada por
 * `tenant_id` do contexto (middleware tenant-aware).
 *
 * Secrets esperados:
 *   BLING_CLIENT_ID / BLING_CLIENT_SECRET / BLING_WEBHOOK_SECRET
 * O callback OAuth vive em /api/public/bling/callback (server route público).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";
import { tdb, type TenantDb } from "@/integrations/supabase/tenant-db";

const BLING_API = "https://www.bling.com.br/Api/v3";
const TOKEN_URL = "https://www.bling.com.br/Api/v3/oauth/token";

const INBOUND_BLOCKED_MESSAGE =
  "Sincronização de entrada desativada: o ERP Norte Sul é a fonte oficial.";

async function assertTenantBlingAdmin(supabase: unknown, userId: string, tenantId: string) {
  await requireTenantRole(supabase, userId, tenantId, ["owner", "admin"]);
}

async function log(
  supabase: unknown,
  tenantId: string,
  args: {
    entity: "produto" | "imagem" | "estoque" | "preco" | "cliente" | "pedido";
    entity_id?: string | null;
    action: string;
    status?: "pendente" | "sucesso" | "erro";
    message?: string;
    payload?: unknown;
  },
) {
  await tdb(supabase).from("bling_sync_logs").insert({
    tenant_id: tenantId,
    entity: args.entity,
    entity_id: args.entity_id ?? null,
    action: args.action,
    status: args.status ?? "pendente",
    message: args.message ?? null,
    payload: args.payload ?? null,
  });
}

/** Configuração Bling do tenant ativo. Nunca usa `.limit(1)` global. */
async function loadConfig(sb: TenantDb, tenantId: string, columns: string) {
  const { data } = await sb
    .from("bling_config")
    .select(columns)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data as Record<string, any> | null;
}

/* ================================================================== *
 * Conexão / status
 * ================================================================== */

export const getBlingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    const data = await loadConfig(
      tdb(context.supabase),
      context.tenantId,
      "id,active,last_authorized_at,last_test_at,last_test_status,expires_at,scope,sync_prices,sync_stock,hide_out_of_stock,image_overwrites_manual,manual_price_overrides,auto_sync,sync_interval_minutes,redirect_uri",
    );

    // Client id/secret são secrets; nunca retornar valores brutos.
    const clientIdConfigured = !!process.env.BLING_CLIENT_ID;
    const clientSecretConfigured = !!process.env.BLING_CLIENT_SECRET;

    let connectionStatus: "connected" | "disconnected" | "error" | "configuring" = "disconnected";
    if (data?.last_test_status === "erro") connectionStatus = "error";
    else if (data?.last_authorized_at && data?.expires_at && new Date(data.expires_at) > new Date())
      connectionStatus = "connected";
    else if (data?.last_authorized_at) connectionStatus = "configuring";

    return {
      config: data ?? null,
      clientIdConfigured,
      clientSecretConfigured,
      connectionStatus,
    };
  });

export const testBlingConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    const sb = tdb(context.supabase);
    const cfg = await loadConfig(sb, context.tenantId, "id,access_token,expires_at");

    let status: "sucesso" | "erro" = "erro";
    let message = "Sem access_token — conecte-se ao Bling primeiro.";
    if (cfg?.access_token && cfg.expires_at && new Date(cfg.expires_at) > new Date()) {
      status = "sucesso";
      message = "Token válido. Conector Bling operacional.";
    } else if (cfg?.access_token) {
      status = "erro";
      message = "Access token expirado — renove a conexão.";
    }

    if (cfg?.id) {
      await sb
        .from("bling_config")
        .update({ last_test_at: new Date().toISOString(), last_test_status: status })
        .eq("id", cfg.id)
        .eq("tenant_id", context.tenantId);
    }

    await log(context.supabase, context.tenantId, {
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
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    const sb = tdb(context.supabase);
    const cfg = await loadConfig(sb, context.tenantId, "id");
    if (!cfg?.id) throw new Error("Configuração Bling não encontrada para este tenant.");
    await sb
      .from("bling_config")
      .update({
        access_token: null,
        refresh_token: null,
        expires_at: null,
        last_authorized_at: null,
        last_test_status: null,
      })
      .eq("id", cfg.id)
      .eq("tenant_id", context.tenantId);
    await log(context.supabase, context.tenantId, {
      entity: "produto",
      action: "revoke",
      status: "sucesso",
      message: "Conexão com o conector Bling revogada.",
    });
    return { ok: true };
  });

/* ================================================================== *
 * Config toggles do conector (sem flags de autoridade sobre dados)
 * ================================================================== */

export const updateBlingConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: {
      active?: boolean;
      auto_sync?: boolean;
      sync_interval_minutes?: number;
      sync_prices?: boolean;
      sync_stock?: boolean;
      hide_out_of_stock?: boolean;
      image_overwrites_manual?: boolean;
      manual_price_overrides?: boolean;
    }) => i,
  )
  .handler(async ({ data, context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    const sb = tdb(context.supabase);
    const cfg = await loadConfig(sb, context.tenantId, "id");
    if (!cfg?.id) throw new Error("Configuração Bling não encontrada para este tenant.");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of Object.keys(data)) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) patch[key] = value;
    }
    const { error } = await sb
      .from("bling_config")
      .update(patch)
      .eq("id", cfg.id)
      .eq("tenant_id", context.tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ================================================================== *
 * Chamada à API do Bling (somente leitura / enriquecimento de mídia)
 * ================================================================== */

async function refreshTokenIfNeeded(sb: TenantDb, tenantId: string) {
  const cfg = await loadConfig(sb, tenantId, "id,access_token,refresh_token,expires_at");
  if (!cfg) throw new Error("bling_config não inicializado para este tenant.");
  if (!cfg.access_token) throw new Error("Sem access_token. Conecte-se ao Bling primeiro.");

  const expiresAt = cfg.expires_at ? new Date(cfg.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return cfg.access_token as string;

  if (!cfg.refresh_token) throw new Error("Access token expirado e sem refresh_token. Reautorize.");
  const clientId = process.env.BLING_CLIENT_ID!;
  const clientSecret = process.env.BLING_CLIENT_SECRET!;
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(TOKEN_URL, {
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao renovar token: ${res.status} ${text.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const newExp = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  await sb
    .from("bling_config")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? cfg.refresh_token,
      expires_at: newExp,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cfg.id)
    .eq("tenant_id", tenantId);
  return json.access_token as string;
}

async function blingFetch(token: string, path: string) {
  const res = await fetch(`${BLING_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bling ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/* ================================================================== *
 * Sincronizações de ENTRADA — bloqueadas por arquitetura
 * ================================================================== */

async function blockedInbound(
  supabase: unknown,
  tenantId: string,
  entity: "produto" | "estoque" | "preco" | "cliente",
) {
  await log(supabase, tenantId, {
    entity,
    action: "inbound_blocked",
    status: "erro",
    message: INBOUND_BLOCKED_MESSAGE,
  });
  return { ok: false as const, blocked: true as const, message: INBOUND_BLOCKED_MESSAGE };
}

export const syncBlingProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    return blockedInbound(context.supabase, context.tenantId, "produto");
  });

export const syncBlingStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    return blockedInbound(context.supabase, context.tenantId, "estoque");
  });

export const syncBlingPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    return blockedInbound(context.supabase, context.tenantId, "preco");
  });

export const syncBlingCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    return blockedInbound(context.supabase, context.tenantId, "cliente");
  });

/* ================================================================== *
 * Enriquecimento de mídia (única sincronização de entrada permitida)
 * ================================================================== */

/**
 * Resolve o ID externo do Bling preferindo `external_entity_mappings`;
 * `products.bling_id` é fallback legado apenas de leitura.
 */
async function resolveExternalProductIds(
  sb: TenantDb,
  tenantId: string,
  productIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (productIds.length === 0) return out;
  const { data } = await sb
    .from("external_entity_mappings")
    .select("internal_id, external_id")
    .eq("tenant_id", tenantId)
    .eq("provider", "bling")
    .eq("entity_type", "product")
    .in("internal_id", productIds);
  for (const row of (data ?? []) as Array<{ internal_id: string; external_id: string }>) {
    if (row.internal_id && row.external_id) out.set(row.internal_id, String(row.external_id));
  }
  return out;
}

export const syncBlingImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { batchSize?: number; onlyMissing?: boolean } | undefined) => i ?? {})
  .handler(async ({ data, context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    const sb = tdb(context.supabase);
    const tenantId = context.tenantId;
    const batchSize = Math.min(Math.max(data.batchSize ?? 120, 10), 200);
    const onlyMissing = data.onlyMissing !== false;

    try {
      const token = await refreshTokenIfNeeded(sb, tenantId);

      const PAGE = 1000;
      async function selectAll<T = any>(build: (from: number, to: number) => any): Promise<T[]> {
        const out: T[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data: page, error } = await build(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const rows = (page ?? []) as T[];
          out.push(...rows);
          if (rows.length < PAGE) break;
          if (from > 200_000) break;
        }
        return out;
      }

      let prods: Array<{ id: string; bling_id: string | null; name: string }> = [];
      if (onlyMissing) {
        const withImg = await selectAll<{ product_id: string }>((from, to) =>
          sb.from("product_images").select("product_id").eq("tenant_id", tenantId).range(from, to),
        );
        const withImgSet = new Set<string>(withImg.map((r) => r.product_id));
        for (let from = 0; prods.length < batchSize; from += PAGE) {
          const { data: page, error } = await sb
            .from("products")
            .select("id,bling_id,name")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const rows = (page ?? []) as Array<{ id: string; bling_id: string | null; name: string }>;
          if (rows.length === 0) break;
          for (const row of rows) {
            if (!withImgSet.has(row.id)) {
              prods.push(row);
              if (prods.length >= batchSize) break;
            }
          }
          if (rows.length < PAGE) break;
          if (from > 200_000) break;
        }
      } else {
        const { data: allProds } = await sb
          .from("products")
          .select("id,bling_id,name")
          .eq("tenant_id", tenantId)
          .order("updated_at", { ascending: true, nullsFirst: true })
          .limit(batchSize);
        prods = (allProds ?? []) as typeof prods;
      }

      const mappings = await resolveExternalProductIds(
        sb,
        tenantId,
        prods.map((p) => p.id),
      );

      let imagesSaved = 0;
      let withImages = 0;
      let processed = 0;
      let errors = 0;
      let skipped = 0;

      for (const prod of prods) {
        const externalId = mappings.get(prod.id) ?? prod.bling_id;
        if (!externalId) {
          skipped++;
          continue;
        }
        try {
          const det: any = await blingFetch(token, `/produtos/${externalId}`);
          const midia = det?.data?.midia?.imagens ?? {};
          const imgs: string[] = [
            ...(midia.externas ?? []),
            ...(midia.internas ?? []),
            ...(det?.data?.imagens ?? []),
          ]
            .map((img: any) => img?.link ?? img?.url ?? img?.arquivo ?? img)
            .filter((u: any) => typeof u === "string" && /^https?:\/\//.test(u));

          processed++;

          if (imgs.length > 0) {
            await sb
              .from("product_images")
              .delete()
              .eq("product_id", prod.id)
              .eq("tenant_id", tenantId);
            const rows = imgs.map((url: string, idx: number) => ({
              tenant_id: tenantId,
              product_id: prod.id,
              url,
              alt: prod.name,
              sort_order: idx,
              is_primary: idx === 0,
            }));
            await sb.from("product_images").insert(rows);
            withImages++;
            imagesSaved += rows.length;
          }
        } catch (err: any) {
          errors++;
          await log(context.supabase, tenantId, {
            entity: "imagem",
            entity_id: prod.id,
            action: "sync_one",
            status: "erro",
            message: err?.message?.slice(0, 300),
          });
        }
        // rate-limit: ~3 req/s
        await new Promise((r) => setTimeout(r, 350));
      }

      let remaining = 0;
      if (onlyMissing) {
        const withImg2 = await selectAll<{ product_id: string }>((from, to) =>
          sb.from("product_images").select("product_id").eq("tenant_id", tenantId).range(from, to),
        );
        const uniqueWithImg = new Set<string>(withImg2.map((r) => r.product_id)).size;
        const { count: totalProds } = await sb
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId);
        remaining = Math.max(0, (totalProds ?? 0) - uniqueWithImg);
      }

      const msg =
        `Lote: ${processed} produtos verificados · ${withImages} com imagem · ${imagesSaved} imagens salvas` +
        (skipped ? ` · ${skipped} sem ID externo` : "") +
        (errors ? ` · ${errors} erros` : "") +
        (onlyMissing ? ` · restam ${remaining} produtos sem imagem` : "");
      await log(context.supabase, tenantId, {
        entity: "imagem",
        action: "sync_batch",
        status: "sucesso",
        message: msg,
      });
      return { ok: true, message: msg, processed, withImages, imagesSaved, errors, skipped, remaining };
    } catch (e: any) {
      await log(context.supabase, tenantId, {
        entity: "imagem",
        action: "sync_batch",
        status: "erro",
        message: e?.message?.slice(0, 500),
      });
      throw e;
    }
  });

/* ================================================================== *
 * Pedidos: fluxo outbound ERP → Bling (fase futura)
 * ================================================================== */

export const sendPendingOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    await log(context.supabase, context.tenantId, {
      entity: "pedido",
      action: "send_pending",
      status: "pendente",
      message: "Envio de pedidos (ERP → Bling) será implementado em fase futura.",
    });
    return { ok: false, message: "Envio de pedidos (ERP → Bling) será implementado em fase futura." };
  });

/* ================================================================== *
 * Reprocessar um log específico
 * ================================================================== */

export const reprocessBlingLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { log_id: string }) => i)
  .handler(async ({ data, context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    const { data: original, error } = await tdb(context.supabase)
      .from("bling_sync_logs")
      .select("entity,entity_id,action,payload")
      .eq("id", data.log_id)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error || !original) throw new Error(error?.message ?? "Log não encontrado");
    await log(context.supabase, context.tenantId, {
      entity: original.entity,
      entity_id: original.entity_id,
      action: `${original.action}:retry`,
      status: "pendente",
      message: "Reprocessamento solicitado manualmente.",
      payload: original.payload,
    });
    return { ok: true };
  });

/* ================================================================== *
 * Estatísticas agregadas para os cabeçalhos das abas
 * ================================================================== */

export const getBlingStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertTenantBlingAdmin(context.supabase, context.userId, context.tenantId);
    const sb = tdb(context.supabase);
    const base = () =>
      sb
        .from("bling_sync_logs")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId);
    const [{ count: total }, { count: errors }, { count: pending }] = await Promise.all([
      base(),
      base().eq("status", "erro"),
      base().eq("status", "pendente"),
    ]);
    return { total: total ?? 0, errors: errors ?? 0, pending: pending ?? 0 };
  });
