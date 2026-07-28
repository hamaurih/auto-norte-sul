import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "check_stock",
  title: "Check stock",
  description:
    "Check current stock and price for one or more products by SKU or slug. Returns the effective available quantity considering multi-branch inventory (when configured) plus the legacy per-product stock. Use before quoting or committing to a sale.",
  inputSchema: {
    skus: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(50)
      .optional()
      .describe("List of SKUs to check."),
    slugs: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(50)
      .optional()
      .describe("List of product slugs to check."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ skus, slugs }) => {
    if ((!skus || skus.length === 0) && (!slugs || slugs.length === 0)) {
      return {
        content: [{ type: "text", text: "Informe pelo menos um SKU ou slug." }],
        isError: true,
      };
    }
    const tenantSlug = process.env.TENANT_STOREFRONT_SLUG;
    if (!tenantSlug) {
      return {
        content: [{ type: "text", text: "TENANT_STOREFRONT_SLUG não configurado." }],
        isError: true,
      };
    }
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "x-tenant-slug": tenantSlug } },
      },
    );
    let q = supabase
      .from("products")
      .select("id, sku, slug, name, stock, price_b2c, sale_price_b2c, active");
    if (skus && slugs) q = q.or(`sku.in.(${skus.join(",")}),slug.in.(${slugs.join(",")})`);
    else if (skus) q = q.in("sku", skus);
    else if (slugs) q = q.in("slug", slugs);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const productIds = (data ?? []).map((p) => p.id);
    let stockByProduct = new Map<string, { on_hand: number; reserved: number; per_branch: Array<{ branch: string; on_hand: number; reserved: number }> }>();
    if (productIds.length > 0) {
      const { data: ps } = await supabase
        .from("product_stock")
        .select("product_id, on_hand, reserved, warehouse:warehouses(name, branch:branches(name))")
        .in("product_id", productIds);
      for (const r of ps ?? []) {
        const cur = stockByProduct.get(r.product_id as string) ?? { on_hand: 0, reserved: 0, per_branch: [] };
        cur.on_hand += r.on_hand ?? 0;
        cur.reserved += r.reserved ?? 0;
        const branchName = (r as any).warehouse?.branch?.name ?? "—";
        cur.per_branch.push({ branch: branchName, on_hand: r.on_hand ?? 0, reserved: r.reserved ?? 0 });
        stockByProduct.set(r.product_id as string, cur);
      }
    }

    const items = (data ?? []).map((p) => {
      const multi = stockByProduct.get(p.id);
      const hasMulti = !!multi && multi.per_branch.length > 0;
      const multiAvailable = hasMulti ? Math.max(multi!.on_hand - multi!.reserved, 0) : 0;
      const legacy = p.stock ?? 0;
      // Regra: se existe estoque multi-filial, usa multi; senão, fallback legado. Nunca soma.
      const available_total = hasMulti ? multiAvailable : legacy;
      return {
        sku: p.sku, slug: p.slug, name: p.name, active: p.active,
        legacy_stock: legacy,
        available_multi: multiAvailable,
        source: hasMulti ? "multi" : "legacy",
        available_total,
        available: available_total > 0 && p.active,
        per_branch: multi?.per_branch ?? [],
        price: p.sale_price_b2c ?? p.price_b2c,
      };
    });
    return {
      content: [{ type: "text", text: JSON.stringify(items) }],
      structuredContent: { items },
    };
  },
});
