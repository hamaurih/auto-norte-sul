import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { createMcpSupabase } from "../supabase.server";

export default defineTool({
  name: "get_product",
  title: "Get product",
  description: "Fetch full public details of a single active product by slug.",
  inputSchema: { slug: z.string().trim().min(1).max(160).describe("Product slug (URL identifier).") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ slug }) => {
    const supabase = createMcpSupabase();
    const { data, error } = await supabase
      .from("products")
      .select("id, sku, name, slug, short_description, description, price_b2c, sale_price_b2c, compare_at_price, stock, active, brand:brands(name, slug), category:categories(name, slug), images:product_images(url, alt, is_primary, sort_order)")
      .eq("slug", slug)
      .eq("active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Product not found" }], isError: true };
    const product = { ...data, price: data.sale_price_b2c ?? data.price_b2c };
    return {
      content: [{ type: "text", text: JSON.stringify(product) }],
      structuredContent: { product },
    };
  },
});