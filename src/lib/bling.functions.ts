/**
 * Bling ERP integration — server functions.
 *
 * Bling is the operational ERP: source-of-truth (opcional) for produtos, imagens, estoque,
 * preços B2C, clientes e destino dos pedidos.
 * O site controla preços B2B, promoções, cupons, vendedores, IA A&S Business e app futuro.
 *
 * Secrets esperados (Lovable Cloud → Secrets):
 *   BLING_CLIENT_ID      — Client ID do app registrado em developer.bling.com.br
 *   BLING_CLIENT_SECRET  — Client Secret
 *   BLING_WEBHOOK_SECRET — Assinatura HMAC dos webhooks
 *
 * O callback OAuth vive em /api/public/bling/callback (server route público).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  deriveInternalCodeFromSku,
  normalizeCode,
  splitManufacturerCodeFromName,
} from "@/lib/product-codes";

const BLING_AUTHORIZE_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";

async function assertAdmin(supabase: any, userId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

async function log(
  supabase: any,
  args: {
    entity: "produto" | "imagem" | "estoque" | "preco" | "cliente" | "pedido";
    entity_id?: string | null;
    action: string;
    status?: "pendente" | "sucesso" | "erro";
    message?: string;
    payload?: any;
  },
) {
  await supabase.from("bling_sync_logs").insert({
    entity: args.entity,
    entity_id: args.entity_id ?? null,
    action: args.action,
    status: args.status ?? "pendente",
    message: args.message ?? null,
    payload: args.payload ?? null,
  });
}

/* ================================================================== *
 * Conexão / OAuth
 * ================================================================== */

export const getBlingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data } = await (context.supabase as any)
      .from("bling_config")
      .select(
        "id,active,last_authorized_at,last_test_at,last_test_status,expires_at,scope,sync_prices,sync_stock,hide_out_of_stock,image_overwrites_manual,manual_price_overrides,source_products,source_stock,source_price_b2c,auto_sync,sync_interval_minutes,redirect_uri",
      )
      .limit(1)
      .maybeSingle();

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

export const getBlingAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { redirectUri: string }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const clientId = process.env.BLING_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "BLING_CLIENT_ID não configurado. Adicione os secrets BLING_CLIENT_ID e BLING_CLIENT_SECRET nas configurações do backend.",
      );
    }
    await (context.supabase as any)
      .from("bling_config")
      .update({ redirect_uri: data.redirectUri, updated_at: new Date().toISOString() })
      .eq("id", (await (context.supabase as any).from("bling_config").select("id").limit(1).single()).data.id);

    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: data.redirectUri,
      state,
    });
    return { url: `${BLING_AUTHORIZE_URL}?${params.toString()}` };
  });

export const testBlingConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: cfg } = await (context.supabase as any)
      .from("bling_config")
      .select("id,access_token,expires_at")
      .limit(1)
      .maybeSingle();

    let status: "sucesso" | "erro" = "erro";
    let message = "Sem access_token — conecte-se ao Bling primeiro.";
    if (cfg?.access_token && cfg.expires_at && new Date(cfg.expires_at) > new Date()) {
      status = "sucesso";
      message = "Token válido. Conexão com Bling operacional.";
    } else if (cfg?.access_token) {
      status = "erro";
      message = "Access token expirado — renove a conexão.";
    }

    await (context.supabase as any)
      .from("bling_config")
      .update({ last_test_at: new Date().toISOString(), last_test_status: status })
      .eq("id", cfg?.id);

    await log(context.supabase, { entity: "produto", action: "test_connection", status, message });
    return { status, message };
  });

export const revokeBlingConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: cfg } = await (context.supabase as any).from("bling_config").select("id").limit(1).single();
    await (context.supabase as any)
      .from("bling_config")
      .update({
        access_token: null,
        refresh_token: null,
        expires_at: null,
        last_authorized_at: null,
        last_test_status: null,
      })
      .eq("id", cfg.id);
    await log(context.supabase, {
      entity: "produto",
      action: "revoke",
      status: "sucesso",
      message: "Conexão com Bling revogada.",
    });
    return { ok: true };
  });

/* ================================================================== *
 * Config toggles
 * ================================================================== */

export const updateBlingConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: {
      active?: boolean;
      source_products?: boolean;
      source_stock?: boolean;
      source_price_b2c?: boolean;
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
    await assertAdmin(context.supabase, context.userId);
    const { data: cfg } = await (context.supabase as any).from("bling_config").select("id").limit(1).single();
    const patch: any = { updated_at: new Date().toISOString() };
    for (const k of Object.keys(data)) if ((data as any)[k] !== undefined) patch[k] = (data as any)[k];
    const { error } = await (context.supabase as any).from("bling_config").update(patch).eq("id", cfg.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ================================================================== *
 * Bling API v3 — mirror mode (Bling é mestre para produtos/estoque/preço B2C)
 * ================================================================== */

const BLING_API = "https://www.bling.com.br/Api/v3";
const TOKEN_URL = "https://www.bling.com.br/Api/v3/oauth/token";

async function refreshTokenIfNeeded(supabase: any) {
  const { data: cfg } = await supabase
    .from("bling_config")
    .select("id,access_token,refresh_token,expires_at")
    .limit(1)
    .maybeSingle();
  if (!cfg) throw new Error("bling_config não inicializado.");
  if (!cfg.access_token) throw new Error("Sem access_token. Conecte-se ao Bling primeiro.");

  const expiresAt = cfg.expires_at ? new Date(cfg.expires_at).getTime() : 0;
  // renova se falta menos de 60s
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
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refresh_token }).toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha ao renovar token: ${res.status} ${t.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const newExp = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  await supabase
    .from("bling_config")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? cfg.refresh_token,
      expires_at: newExp,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cfg.id);
  return json.access_token as string;
}

async function blingFetch(token: string, path: string) {
  const res = await fetch(`${BLING_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Bling ${path} → ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

function slugify(s: string) {
  return (s || "produto")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function splitManufacturerCode(rawName: string) {
  const normalizedName = (rawName || "").trim().replace(/\s+/g, " ");
  const match = normalizedName.match(/^([A-Za-z0-9][A-Za-z0-9._/-]{2,})\s+(.+)$/);
  if (!match || !/\d/.test(match[1])) {
    return { name: normalizedName, manufacturerCode: null as string | null };
  }
  return {
    name: match[2].trim(),
    manufacturerCode: match[1].toUpperCase(),
  };
}

async function uniqueSlug(supabase: any, base: string, blingId: string) {
  let slug = base || `produto-${blingId}`;
  const { data } = await supabase.from("products").select("id,bling_id").eq("slug", slug).maybeSingle();
  if (!data || data.bling_id === blingId) return slug;
  return `${slug}-${blingId}`;
}

/**
 * Sincroniza produtos do Bling (modo espelho).
 * Faz paginação em /produtos e upsert em public.products usando bling_id como chave.
 */
export const syncBlingProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    try {
      const token = await refreshTokenIfNeeded(sb);
      let pagina = 1;
      const limite = 100;
      let created = 0;
      let updated = 0;
      // trava dura de segurança para não rodar infinitamente
      while (pagina <= 50) {
        const json: any = await blingFetch(token, `/produtos?pagina=${pagina}&limite=${limite}`);
        const lista: any[] = json?.data ?? [];
        if (lista.length === 0) break;
        for (const p of lista) {
          const blingId = String(p.id);
          const rawName = p.nome ?? `Produto ${blingId}`;
          const { name: nome, manufacturerCode } = splitManufacturerCode(rawName);
          const sku = p.codigo ?? blingId;
          const preco = Number(p.preco ?? 0);
          const estoque = Number(p.estoque?.saldoVirtualTotal ?? p.estoque?.saldo ?? 0);
          const ativo = (p.situacao ?? "A") === "A";

          const { data: existing } = await sb
            .from("products")
            .select("id,slug,manufacturer_code")
            .eq("bling_id", blingId)
            .maybeSingle();

          if (existing) {
            await sb
              .from("products")
              .update({
                name: nome,
                manufacturer_code: manufacturerCode ?? existing.manufacturer_code ?? null,
                sku,
                price_b2c: preco,
                stock: estoque,
                active: ativo,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
            updated++;
          } else {
            const slug = await uniqueSlug(sb, slugify(nome), blingId);
            await sb.from("products").insert({
              bling_id: blingId,
              sku,
              name: nome,
              manufacturer_code: manufacturerCode,
              slug,
              price_b2c: preco,
              stock: estoque,
              active: ativo,
            });
            created++;
          }
        }
        if (lista.length < limite) break;
        pagina++;
      }
      const msg = `Sincronizados ${created + updated} produtos (${created} novos, ${updated} atualizados).`;
      await log(sb, { entity: "produto", action: "sync_all", status: "sucesso", message: msg });
      return { ok: true, message: msg, created, updated };
    } catch (e: any) {
      await log(sb, {
        entity: "produto",
        action: "sync_all",
        status: "erro",
        message: e?.message?.slice(0, 500) ?? "Erro desconhecido",
      });
      throw e;
    }
  });

/**
 * Sincroniza imagens: para cada produto com bling_id, busca detalhe e salva URLs em product_images.
 */
/**
 * Sincroniza imagens do Bling em lotes.
 * - Prioriza produtos SEM imagem (usa RPC não; faz duas queries e diferença).
 * - Rate-limit ~3 req/s (Bling API v3).
 * - Marca updated_at mesmo quando o produto não tem mídia, para não voltar na fila.
 * - Retorna { processed, withImages, imagesSaved, remaining } para permitir auto-loop no UI.
 */
export const syncBlingImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { batchSize?: number; onlyMissing?: boolean } | undefined) => i ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    const batchSize = Math.min(Math.max(data.batchSize ?? 120, 10), 200);
    const onlyMissing = data.onlyMissing !== false; // default true

    try {
      const token = await refreshTokenIfNeeded(sb);

      // Helper: paginar select ignorando o teto default de 1000 do PostgREST.
      const PAGE = 1000;
      async function selectAll<T = any>(
        build: (from: number, to: number) => any,
      ): Promise<T[]> {
        const out: T[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await build(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as T[];
          out.push(...rows);
          if (rows.length < PAGE) break;
          if (from > 200_000) break; // trava dura de segurança
        }
        return out;
      }

      // 1) IDs de produtos que já têm pelo menos uma imagem (paginado)
      let prods: Array<{ id: string; bling_id: string; name: string }> = [];
      if (onlyMissing) {
        const withImg = await selectAll<{ product_id: string }>((from, to) =>
          sb.from("product_images").select("product_id").range(from, to),
        );
        const withImgSet = new Set<string>(withImg.map((r) => r.product_id));

        // Pagina produtos até coletar batchSize sem imagem
        for (let from = 0; prods.length < batchSize; from += PAGE) {
          const { data: page, error } = await sb
            .from("products")
            .select("id,bling_id,name")
            .not("bling_id", "is", null)
            .order("created_at", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const rows = (page ?? []) as Array<{ id: string; bling_id: string; name: string }>;
          if (rows.length === 0) break;
          for (const r of rows) {
            if (!withImgSet.has(r.id)) {
              prods.push(r);
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
          .not("bling_id", "is", null)
          .order("updated_at", { ascending: true, nullsFirst: true })
          .limit(batchSize);
        prods = allProds ?? [];
      }

      let imagesSaved = 0;
      let withImages = 0;
      let processed = 0;
      let errors = 0;

      for (const prod of prods) {
        try {
          const det: any = await blingFetch(token, `/produtos/${prod.bling_id}`);
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
            await sb.from("product_images").delete().eq("product_id", prod.id);
            const rows = imgs.map((url: string, idx: number) => ({
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

          // Sempre marcar updated_at para tirar da fila de "sem imagem"
          await sb.from("products").update({ updated_at: new Date().toISOString() }).eq("id", prod.id);
        } catch (err: any) {
          errors++;
          await log(sb, {
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

      // Contar restantes (produtos com bling_id e sem imagem) para o UI decidir se continua
      let remaining = 0;
      if (onlyMissing) {
        const withImg2 = await selectAll<{ product_id: string }>((from, to) =>
          sb.from("product_images").select("product_id").range(from, to),
        );
        const uniqueWithImg = new Set<string>(withImg2.map((r) => r.product_id)).size;
        const { count: totalProds } = await sb
          .from("products")
          .select("id", { count: "exact", head: true })
          .not("bling_id", "is", null);
        remaining = Math.max(0, (totalProds ?? 0) - uniqueWithImg);
      }


      const msg =
        `Lote: ${processed} produtos verificados · ${withImages} com imagem · ${imagesSaved} imagens salvas` +
        (errors ? ` · ${errors} erros` : "") +
        (onlyMissing ? ` · restam ${remaining} produtos sem imagem` : "");
      await log(sb, { entity: "imagem", action: "sync_batch", status: "sucesso", message: msg });
      return { ok: true, message: msg, processed, withImages, imagesSaved, errors, remaining };
    } catch (e: any) {
      await log(sb, {
        entity: "imagem",
        action: "sync_batch",
        status: "erro",
        message: e?.message?.slice(0, 500),
      });
      throw e;
    }
  });

/**
 * Estoque e preços B2C vêm no endpoint /produtos — reutilizamos syncBlingProducts.
 */
async function syncFieldsOnly(sb: any, only: "estoque" | "preco") {
  const token = await refreshTokenIfNeeded(sb);
  let pagina = 1;
  const limite = 100;
  let touched = 0;
  while (pagina <= 50) {
    const json: any = await blingFetch(token, `/produtos?pagina=${pagina}&limite=${limite}`);
    const lista: any[] = json?.data ?? [];
    if (lista.length === 0) break;
    for (const p of lista) {
      const blingId = String(p.id);
      const patch: any = { updated_at: new Date().toISOString() };
      if (only === "estoque") patch.stock = Number(p.estoque?.saldoVirtualTotal ?? p.estoque?.saldo ?? 0);
      if (only === "preco") patch.price_b2c = Number(p.preco ?? 0);
      const { data } = await sb.from("products").update(patch).eq("bling_id", blingId).select("id");
      if (data?.length) touched++;
    }
    if (lista.length < limite) break;
    pagina++;
  }
  return touched;
}

export const syncBlingStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    try {
      const n = await syncFieldsOnly(sb, "estoque");
      const msg = `Estoque atualizado em ${n} produtos.`;
      await log(sb, { entity: "estoque", action: "sync_all", status: "sucesso", message: msg });
      return { ok: true, message: msg };
    } catch (e: any) {
      await log(sb, { entity: "estoque", action: "sync_all", status: "erro", message: e?.message?.slice(0, 500) });
      throw e;
    }
  });

export const syncBlingPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    try {
      const n = await syncFieldsOnly(sb, "preco");
      const msg = `Preços B2C atualizados em ${n} produtos.`;
      await log(sb, { entity: "preco", action: "sync_all", status: "sucesso", message: msg });
      return { ok: true, message: msg };
    } catch (e: any) {
      await log(sb, { entity: "preco", action: "sync_all", status: "erro", message: e?.message?.slice(0, 500) });
      throw e;
    }
  });

export const syncBlingCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    await log(context.supabase, {
      entity: "cliente",
      action: "sync_all",
      status: "pendente",
      message: "Sincronização de clientes ainda não implementada (modo espelho foca em produtos).",
    });
    return { ok: false, message: "Sincronização de clientes será implementada em fase futura." };
  });

export const sendPendingOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    await log(context.supabase, {
      entity: "pedido",
      action: "send_pending",
      status: "pendente",
      message: "Envio de pedidos para o Bling ainda não implementado.",
    });
    return { ok: false, message: "Envio de pedidos será implementado em fase futura." };
  });

/* ================================================================== *
 * Reprocess a specific log
 * ================================================================== */

export const reprocessBlingLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { log_id: string }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: original, error } = await (context.supabase as any)
      .from("bling_sync_logs")
      .select("entity,entity_id,action,payload")
      .eq("id", data.log_id)
      .single();
    if (error || !original) throw new Error(error?.message ?? "Log não encontrado");
    await log(context.supabase, {
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
 * Aggregate stats for tab headers
 * ================================================================== */

export const getBlingStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    const [{ count: total }, { count: errors }, { count: pending }] = await Promise.all([
      sb.from("bling_sync_logs").select("*", { count: "exact", head: true }),
      sb.from("bling_sync_logs").select("*", { count: "exact", head: true }).eq("status", "erro"),
      sb.from("bling_sync_logs").select("*", { count: "exact", head: true }).eq("status", "pendente"),
    ]);
    return { total: total ?? 0, errors: errors ?? 0, pending: pending ?? 0 };
  });
