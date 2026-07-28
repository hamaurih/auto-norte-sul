import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { normalizeTerm } from "../../normalize";

export default defineTool({
  name: "search_products",
  title: "Search products",
  description:
    "Search the active product catalog by name, SKU, internal code, description, brand or category. If the query text is itself a brand name (e.g. 'JBL', 'Pioneer', 'Moura', 'Taramps'), returns products of that brand even when the brand name does not appear in the product title. Returns products with prices, stock, brand, image and slug so the agent can quote and check availability.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(1)
      .describe("Search text: product name, SKU, internal code, description or brand (e.g. 'pastilha freio', 'JBL', 'multimídia Pioneer')."),
    brand: z.string().trim().min(1).optional().describe("Restrict results to this brand name or slug."),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
    in_stock_only: z.boolean().optional().describe("If true, only return products with stock greater than zero."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, brand, limit, in_stock_only }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { "x-tenant-slug": process.env.PUBLIC_TENANT_SLUG ?? "norte-sul-real" } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const safe = query.replace(/[,()]/g, " ");

    // Detect brand: match query or explicit `brand` param against brands table
    const brandTerm = (brand ?? query).trim().toLowerCase();
    let matchedBrand: { id: string; name: string; slug: string } | null = null;
    if (brandTerm.length >= 2) {
      const { data: brands } = await supabase
        .from("brands")
        .select("id, name, slug")
        .or(`name.ilike.%${brandTerm}%,slug.ilike.%${brandTerm}%`)
        .limit(3);
      // Prefer exact match if any
      const exact = (brands ?? []).find(
        (b) => b.name.toLowerCase() === brandTerm || b.slug.toLowerCase() === brandTerm,
      );
      matchedBrand = exact ?? brands?.[0] ?? null;
    }

    // Alias lookup (só se não achou marca via texto/param explícito)
    let matchedAlias: { term: string; target_type: string; target_slug: string | null; target_label: string | null } | null = null;
    let matchedCategory: { name: string; slug: string } | null = null;
    if (!matchedBrand) {
      const norm = normalizeTerm(query);
      if (norm.length >= 2) {
        const { data: aliasRows } = await supabase
          .from("search_aliases")
          .select("term, target_type, target_slug, target_id, target_label, weight")
          .eq("is_active", true)
          .eq("normalized_term", norm)
          .order("weight", { ascending: false })
          .limit(1);
        const alias = aliasRows?.[0];
        if (alias) {
          matchedAlias = { term: alias.term, target_type: alias.target_type, target_slug: alias.target_slug, target_label: alias.target_label };
          if (alias.target_type === "brand" && alias.target_slug) {
            const { data: br } = await supabase.from("brands").select("id, name, slug").eq("slug", alias.target_slug).maybeSingle();
            if (br) matchedBrand = br;
          } else if (alias.target_type === "category" && alias.target_slug) {
            const { data: cat } = await supabase.from("categories").select("id, name, slug").eq("slug", alias.target_slug).maybeSingle();
            if (cat) matchedCategory = { name: cat.name, slug: cat.slug };
          }
        }
      }
    }

    let q = supabase
      .from("products")
      .select(
        "id, sku, name, slug, short_description, price_b2c, sale_price_b2c, compare_at_price, stock, active, brand:brands(name, slug), images:product_images(url, is_primary, sort_order)",
      )
      .eq("active", true)
      .order("sales_count", { ascending: false })
      .limit(limit ?? 10);

    if (matchedBrand) {
      q = q.eq("brand_id", matchedBrand.id);
      if (!brand && safe && safe.toLowerCase() !== matchedBrand.name.toLowerCase()) {
        q = q.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,short_description.ilike.%${safe}%`);
      }
    } else if (matchedCategory) {
      const { data: cat } = await supabase.from("categories").select("id").eq("slug", matchedCategory.slug).maybeSingle();
      if (cat) q = q.eq("category_id", cat.id);
      else q = q.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,short_description.ilike.%${safe}%`);
    } else {
      q = q.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,short_description.ilike.%${safe}%`);
    }
    if (in_stock_only) q = q.gt("stock", 0);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const results = (data ?? []).map((p: any) => {
      const imgs = (p.images ?? []).slice().sort(
        (a: any, b: any) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order,
      );
      return {
        id: p.id, sku: p.sku, name: p.name, slug: p.slug,
        short_description: p.short_description,
        price: p.sale_price_b2c ?? p.price_b2c,
        list_price: p.price_b2c,
        compare_at_price: p.compare_at_price,
        stock: p.stock ?? 0,
        available: (p.stock ?? 0) > 0,
        brand: p.brand,
        image_url: imgs[0]?.url ?? null,
      };
    });

    // Registro best-effort de buscas sem resultado
    if (results.length === 0) {
      await supabase.from("search_no_result_logs").insert({
        term: query.slice(0, 200),
        normalized_term: normalizeTerm(query).slice(0, 200),
        origin: "mcp",
        results_count: 0,
        matched_alias: matchedAlias?.term ?? null,
        matched_brand: matchedBrand?.name ?? null,
        matched_category: matchedCategory?.name ?? null,
      });
    }

    let explanation = "";
    if (matchedBrand && matchedAlias) explanation = `Termo "${query}" foi entendido como marca ${matchedBrand.name} via alias.`;
    else if (matchedBrand) explanation = `Encontrei produtos da marca ${matchedBrand.name}.`;
    else if (matchedCategory) explanation = `Encontrei produtos da categoria ${matchedCategory.name} (termo pesquisado: "${query}").`;
    else if (results.length > 0) explanation = `Resultados por busca textual em "${query}".`;

    return {
      content: [
        {
          type: "text",
          text: results.length
            ? `${explanation}\n${JSON.stringify({ matchedBrand, matchedAlias, matchedCategory, count: results.length, results })}`
            : `Nenhum produto ativo encontrado para "${query}".`,
        },
      ],
      structuredContent: { matchedBrand, matchedAlias, matchedCategory, count: results.length, results },
    };
  },
});
