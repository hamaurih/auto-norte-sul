import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { createMcpSupabase } from "../supabase.server";

const listSchema = z.array(z.string().trim().min(1).max(120)).min(1).max(50);

export default defineTool({
  name: "check_stock",
  title: "Check stock",
  description: "Check current stock and public price for one or more products by SKU or slug.",
  inputSchema: {
    skus: listSchema.optional().describe("List of SKUs to check."),
    slugs: listSchema.optional().describe("List of product slugs to check."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ skus, slugs }) => {
    if ((!skus || skus.length === 0) && (!slugs || slugs.length === 0)) {
      return { content: [{ type: "text", text: "Informe pelo menos um SKU ou slug." }], isError: true };
    }
    const supabase = createMcpSupabase();
    const requests: Array<PromiseLike<any>> = [];
    if (skus?.length) requests.push(supabase.from("products").select("id, sku, slug, name, stock, price_b2c, sale_price_b2c, active").eq("active", true).is("deleted_at", null).in("sku", [...new Set(skus)]));
    if (slugs?.length) requests.push(supabase.from("products").select("id, sku, slug, name, stock, price_b2c, sale_price_b2c, active").eq("active", true).is("deleted_at", null).in("slug", [...new Set(slugs)]));
    const responses = await Promise.all(requests);
    const error = responses.find((response) => response.error)?.error;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const data = Array.from(new Map(responses.flatMap((response) => response.data ?? []).map((product) => [product.id, product])).values());
    const productIds = data.map((product) => product.id);
    const stockByProduct = new Map<string, { on_hand: number; reserved: number; per_branch: Array<{ branch: string; on_hand: number; reserved: number }> }>();
    if (productIds.length > 0) {
      const { data: stockRows, error: stockError } = await supabase
        .from("product_stock")
        .select("product_id, on_hand, reserved, warehouse:warehouses(name, branch:branches(name))")
        .in("product_id", productIds);
      if (stockError) return { content: [{ type: "text", text: stockError.message }], isError: true };
      for (const row of stockRows ?? []) {
        const current = stockByProduct.get(row.product_id) ?? { on_hand: 0, reserved: 0, per_branch: [] };
        const onHand = Number(row.on_hand ?? 0);
        const reserved = Number(row.reserved ?? 0);
        current.on_hand += onHand;
        current.reserved += reserved;
        const branchName = (row as any).warehouse?.branch?.name ?? "—";
        current.per_branch.push({ branch: branchName, on_hand: onHand, reserved });
        stockByProduct.set(row.product_id, current);
      }
    }
    const items = data.map((product) => {
      const multi = stockByProduct.get(product.id);
      const hasMulti = Boolean(multi?.per_branch.length);
      const available = hasMulti ? Math.max(multi!.on_hand - multi!.reserved, 0) : Math.max(Number(product.stock ?? 0), 0);
      return {
        sku: product.sku,
        slug: product.slug,
        name: product.name,
        active: product.active,
        available_total: available,
        available: available > 0,
        source: hasMulti ? "multi" : "legacy",
        price: product.sale_price_b2c ?? product.price_b2c,
        per_branch: multi?.per_branch ?? [],
      };
    });
    return {
      content: [{ type: "text", text: JSON.stringify(items) }],
      structuredContent: { items },
    };
  },
});