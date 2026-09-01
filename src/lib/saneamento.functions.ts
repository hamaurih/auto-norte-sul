import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";

type Role = "admin" | "gerente" | "vendedor" | "staff";

async function assertRoles(sb: any, userId: string, roles: Role[]) {
  const { data } = await sb.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r: { role: string }) => roles.includes(r.role as Role))) {
    throw new Error("Forbidden");
  }
}

// ============ STATS ============
export const getSaneamentoStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .rpc("get_catalog_sanitation_stats", { p_tenant_id: context.tenantId })
      .single();
    if (error) throw new Error(error.message);
    const n = (value: unknown) => Number(value ?? 0);
    return {
      total: n(data.total),
      semMarca: n(data.sem_marca),
      semCategoria: n(data.sem_categoria),
      semSku: n(data.sem_sku),
      semPreco: n(data.sem_preco),
      semEstoque: n(data.sem_estoque),
      semImagem: n(data.sem_imagem),
      imagemExpirada: n(data.imagem_expirada),
      imagensValidas: n(data.imagens_validas),
      semAplicacao: n(data.sem_aplicacao),
      semMultiEstoque: n(data.sem_multi_estoque),
    };
  });

// ============ LIST PROBLEM PRODUCTS ============
export const listProblemProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    problem: "sem_marca" | "sem_categoria" | "sem_sku" | "sem_preco" | "sem_estoque" | "sem_imagem" | "sem_aplicacao" | "sem_multi";
    limit?: number;
    offset?: number;
    search?: string;
  }) => input)
  .handler(async ({ data, context }) => {
    const limit = Math.min(data.limit ?? 100, 500);
    const offset = data.offset ?? 0;
    const { data: rows, error } = await (context.supabase as any).rpc(
      "list_catalog_sanitation_products",
      {
        p_tenant_id: context.tenantId,
        p_problem: data.problem,
        p_limit: limit,
        p_offset: offset,
        p_search: data.search?.trim() || null,
      },
    );
    if (error) throw new Error(error.message);
    const cleanRows = (rows ?? []).map(({ total_count: _totalCount, ...row }: any) => row);
    return { rows: cleanRows, count: Number(rows?.[0]?.total_count ?? 0) };
  });

// ============ BRAND SUGGESTIONS ============
type BrandSuggestion = { productId: string; brandId: string; brandName: string; confidence: "alta" | "media" | "baixa"; matchedIn: string };

export const suggestBrands = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productIds?: string[]; scanAll?: boolean; limit?: number }) => input)
  .handler(async ({ data, context }): Promise<BrandSuggestion[]> => {
    const sb = context.supabase;
    const { data: brands } = await sb.from("brands").select("id, name, slug");
    if (!brands || brands.length === 0) return [];

    let query = sb.from("products").select("id, name, short_description, description, sku, internal_code").is("brand_id", null);
    if (data.productIds?.length) query = query.in("id", data.productIds);
    if (data.scanAll) query = query.limit(Math.min(data.limit ?? 1000, 5000));
    else query = query.limit(Math.min(data.limit ?? 200, 1000));

    const { data: prods } = await query;
    const suggestions: BrandSuggestion[] = [];

    for (const p of prods ?? []) {
      const name = (p.name ?? "").toLowerCase();
      const desc = ((p.short_description ?? "") + " " + (p.description ?? "")).toLowerCase();
      const sku = ((p.sku ?? "") + " " + (p.internal_code ?? "")).toLowerCase();

      let best: BrandSuggestion | null = null;
      for (const b of brands) {
        const needle = b.name.toLowerCase();
        // Word-boundary check to avoid partial matches (e.g. "jbl" inside longer word)
        const re = new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
        let confidence: "alta" | "media" | "baixa" | null = null;
        let matchedIn = "";
        if (re.test(name)) { confidence = "alta"; matchedIn = "nome"; }
        else if (re.test(sku)) { confidence = "alta"; matchedIn = "sku"; }
        else if (re.test(desc)) { confidence = "media"; matchedIn = "descrição"; }
        else if (name.includes(needle) || sku.includes(needle)) { confidence = "baixa"; matchedIn = "substring"; }
        if (confidence) {
          if (!best || rank(confidence) > rank(best.confidence)) {
            best = { productId: p.id, brandId: b.id, brandName: b.name, confidence, matchedIn };
          }
        }
      }
      if (best) suggestions.push(best);
    }
    return suggestions;
  });

function rank(c: "alta" | "media" | "baixa") { return c === "alta" ? 3 : c === "media" ? 2 : 1; }

// ============ CATEGORY SUGGESTIONS ============
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "som-automotivo": ["alto-falante", "alto falante", "corneta", "módulo", "modulo", "som", "subwoofer", "amplificador", "tweeter", "driver", "caixa acustica", "woofer"],
  "multimidia": ["multimídia", "multimidia", "central", "dvd", "player", "auto radio", "auto rádio", "auto-rádio", "auto-radio", "carplay", "android auto", "bluetooth"],
  "iluminacao": ["farol", "lâmpada", "lampada", "led", "milha", "xenon", "iluminação", "iluminacao", "neblina"],
  "seguranca": ["alarme", "trava", "sensor", "câmera", "camera de ré", "câmera de ré", "airbag"],
  "rodas-pneus": ["pneu", "roda", "aro", "calota"],
  "acessorios-internos": ["tapete", "carpete", "capa banco", "volante", "manopla", "cinto"],
  "acessorios-externos": ["engate", "santantonio", "santo antônio", "estribo", "protetor", "friso", "spoiler", "aerofólio", "aerofolio"],
  "estetica": ["polidor", "cera", "shampoo automotivo", "revitalizador", "lava auto"],
  "performance": ["turbina", "escapamento", "coxim", "amortecedor esportivo"],
};

export const suggestCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productIds?: string[]; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: cats } = await sb.from("categories").select("id, name, slug");
    const catBySlug = new Map((cats ?? []).map((c) => [c.slug, c]));

    let query = sb.from("products").select("id, name, short_description, description").is("category_id", null);
    if (data.productIds?.length) query = query.in("id", data.productIds);
    query = query.limit(Math.min(data.limit ?? 500, 2000));
    const { data: prods } = await query;

    const suggestions: { productId: string; categoryId: string; categorySlug: string; confidence: "alta" | "media" | "baixa"; matched: string }[] = [];
    for (const p of prods ?? []) {
      const hay = ((p.name ?? "") + " " + (p.short_description ?? "") + " " + (p.description ?? "")).toLowerCase();
      let best: { slug: string; matched: string; score: number } | null = null;
      for (const [slug, kws] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const kw of kws) {
          if (hay.includes(kw)) {
            const score = kw.length;
            if (!best || score > best.score) best = { slug, matched: kw, score };
          }
        }
      }
      if (best) {
        const cat = catBySlug.get(best.slug);
        if (cat) {
          const confidence = best.score >= 8 ? "alta" : best.score >= 5 ? "media" : "baixa";
          suggestions.push({ productId: p.id, categoryId: cat.id, categorySlug: best.slug, confidence, matched: best.matched });
        }
      }
    }
    return suggestions;
  });

// ============ APPLY (individual + bulk) ============
export const applyBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string; brandId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const { error } = await context.supabase.from("products").update({ brand_id: data.brandId }).eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const applyBrandBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { assignments: { productId: string; brandId: string; confidence: string }[] }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const high = data.assignments.filter((a) => a.confidence === "alta");
    let ok = 0;
    for (const a of high) {
      const { error } = await context.supabase.from("products").update({ brand_id: a.brandId }).eq("id", a.productId);
      if (!error) ok++;
    }
    return { applied: ok, skipped: data.assignments.length - high.length, rejectedLowConfidence: data.assignments.length - high.length };
  });

export const applyCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string; categoryId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const { error } = await context.supabase.from("products").update({ category_id: data.categoryId }).eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const applyCategoryBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { assignments: { productId: string; categoryId: string; confidence: string }[] }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const high = data.assignments.filter((a) => a.confidence === "alta");
    let ok = 0;
    for (const a of high) {
      const { error } = await context.supabase.from("products").update({ category_id: a.categoryId }).eq("id", a.productId);
      if (!error) ok++;
    }
    return { applied: ok, skipped: data.assignments.length - high.length };
  });

// ============ INIT STOCK FROM LEGACY ============
export const initStockFromLegacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId?: string; all?: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const sb = context.supabase;
    const { data: wh } = await sb
      .from("warehouses")
      .select("id, is_default, branch:branches(is_main)")
      .eq("tenant_id", context.tenantId)
      .order("is_default", { ascending: false });
    const defaultWh = (wh ?? []).find((w: any) => w.is_default && (w.branch as any)?.is_main) ?? wh?.[0];
    if (!defaultWh) throw new Error("Nenhum depósito padrão encontrado. Crie a Matriz.");

    // Products com estoque legado > 0 e SEM product_stock
    const { data: haveMulti } = await sb.from("product_stock").select("product_id").eq("tenant_id", context.tenantId);
    const multiSet = new Set((haveMulti ?? []).map((r) => r.product_id));

    let q = sb.from("products").select("id, stock").eq("tenant_id", context.tenantId).gt("stock", 0);
    if (data.productId) q = q.eq("id", data.productId);
    const { data: prods } = await q;
    const targets = (prods ?? []).filter((p) => !multiSet.has(p.id));

    let created = 0;
    for (const p of targets) {
      const { error } = await sb.from("product_stock").insert({
        tenant_id: context.tenantId,
        product_id: p.id,
        warehouse_id: defaultWh.id,
        on_hand: p.stock,
        reserved: 0,
      });
      if (!error) {
        created++;
        await sb.from("stock_movements").insert({
          tenant_id: context.tenantId,
          product_id: p.id,
          warehouse_id: defaultWh.id,
          type: "IN",
          qty: p.stock,
          reference: "INIT_LEGACY",
          notes: "Inicialização a partir do estoque legado",
          user_id: context.userId,
        });
      }
    }
    return { created, skipped: (prods?.length ?? 0) - targets.length };
  });

// ============ PRODUCT APPLICATIONS ============
export const listApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("product_applications")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("product_id", data.productId)
      .order("vehicle_make");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; product_id: string; vehicle_make: string; vehicle_model: string; year_from?: number | null; year_to?: number | null; notes?: string | null }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const { id, ...row } = data;
    if (id) {
      const { error } = await context.supabase
        .from("product_applications")
        .update(row)
        .eq("tenant_id", context.tenantId)
        .eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: ins, error } = await context.supabase
      .from("product_applications")
      .insert({ ...row, tenant_id: context.tenantId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins.id };
  });

export const deleteApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const { error } = await context.supabase
      .from("product_applications")
      .delete()
      .eq("tenant_id", context.tenantId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
