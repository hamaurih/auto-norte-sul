import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertStaff(supabase: any, userId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isStaff = (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "gerente");
  if (!isStaff) throw new Error("Forbidden");
}

async function count(sb: any, table: string, apply?: (q: any) => any) {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  if (apply) q = apply(q);
  const { count: c } = await q;
  return c ?? 0;
}

export const getCatalogAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertStaff(supabase, userId);
    const sb = supabase;

    const total = await count(sb, "products");
    const ativos = await count(sb, "products", (q) => q.eq("active", true));
    const inativos = await count(sb, "products", (q) => q.eq("active", false));
    const semCategoria = await count(sb, "products", (q) => q.is("category_id", null));
    const semMarca = await count(sb, "products", (q) => q.is("brand_id", null));
    const semSku = await count(sb, "products", (q) => q.or("sku.is.null,sku.eq."));
    const semPreco = await count(sb, "products", (q) => q.or("price_b2c.is.null,price_b2c.eq.0"));
    const semEstoque = await count(sb, "products", (q) => q.or("stock.is.null,stock.lte.0"));
    const comBling = await count(sb, "products", (q) => q.not("bling_id", "is", null));
    const semBling = await count(sb, "products", (q) => q.is("bling_id", null));

    // sem imagem: paginado
    const withImgSet = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from("product_images").select("product_id").range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data) withImgSet.add(r.product_id as string);
      if (data.length < 1000) break;
    }
    const semImagem = Math.max(total - withImgSet.size, 0);

    // sem aplicação veicular
    const withAppSet = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from("product_applications").select("product_id").range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data) withAppSet.add(r.product_id as string);
      if (data.length < 1000) break;
    }
    const semAplicacao = Math.max(total - withAppSet.size, 0);

    return {
      total, ativos, inativos, semCategoria, semMarca, semSku,
      semPreco, semEstoque, semImagem, semAplicacao, comBling, semBling,
    };
  });

export const getBlingAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const sb = context.supabase;
    const { data: cfg } = await sb.from("bling_config").select("access_token, active, updated_at").maybeSingle();
    const { data: lastSync } = await sb
      .from("bling_sync_logs")
      .select("created_at")
      .eq("status", "sucesso")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const importados = await count(sb, "products", (q) => q.not("bling_id", "is", null));
    const erros = await count(sb, "bling_sync_logs", (q) => q.eq("status", "erro"));
    const sucesso24h = await count(sb, "bling_sync_logs", (q) =>
      q.eq("status", "sucesso").gte("created_at", new Date(Date.now() - 86400000).toISOString())
    );
    const { data: ultimosErros } = await sb
      .from("bling_sync_logs")
      .select("entity, action, message, created_at")
      .eq("status", "erro")
      .order("created_at", { ascending: false })
      .limit(10);
    return {
      last_sync_at: lastSync?.created_at ?? null,
      connected: !!(cfg as any)?.access_token && !!(cfg as any)?.active,
      importados,
      erros_total: erros,
      sucesso_24h: sucesso24h,
      ultimos_erros: ultimosErros ?? [],
    };
  });

export const getAiAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const sb = context.supabase;
    const total = await count(sb, "ai_tool_logs");
    const semResultado = await count(sb, "ai_tool_logs", (q) => q.eq("result_count", 0));
    const { data: topTools } = await sb
      .from("ai_tool_logs")
      .select("tool_name")
      .order("created_at", { ascending: false })
      .limit(500);
    const toolCounts = new Map<string, number>();
    for (const r of topTools ?? []) toolCounts.set(r.tool_name, (toolCounts.get(r.tool_name) ?? 0) + 1);
    const tools = Array.from(toolCounts.entries())
      .map(([tool, uses]) => ({ tool, uses }))
      .sort((a, b) => b.uses - a.uses);
    return { total_buscas: total, buscas_sem_resultado: semResultado, tools };
  });
