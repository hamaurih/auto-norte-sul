import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { escapeLike, sanitizeOrQuery } from "../../sanitize";
import { createMcpSupabase } from "../supabase.server";

export default defineTool({
  name: "find_by_vehicle",
  title: "Find products by vehicle",
  description: "Find active products that fit a vehicle make, model and optional year.",
  inputSchema: {
    make: z.string().trim().min(1).max(80).describe("Vehicle make, e.g. Chevrolet."),
    model: z.string().trim().min(1).max(80).optional().describe("Vehicle model, e.g. Onix."),
    year: z.number().int().min(1950).max(2100).optional(),
    query: z.string().trim().min(1).max(160).optional().describe("Optional product text filter."),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ make, model, year, query, limit }) => {
    const supabase = createMcpSupabase();
    let appQ = supabase
      .from("product_applications")
      .select("product_id, vehicle_make, vehicle_model, year_from, year_to")
      .ilike("vehicle_make", `%${escapeLike(make)}%`);
    if (model) appQ = appQ.ilike("vehicle_model", `%${escapeLike(model)}%`);
    const { data: apps, error: appErr } = await appQ.limit(500);
    if (appErr) return { content: [{ type: "text", text: appErr.message }], isError: true };
    let productIds = Array.from(new Set((apps ?? []).map((app) => app.product_id)));
    if (year) {
      const matching = new Set((apps ?? [])
        .filter((app) => (app.year_from == null || year >= app.year_from) && (app.year_to == null || year <= app.year_to))
        .map((app) => app.product_id));
      productIds = productIds.filter((id) => matching.has(id));
    }
    if (productIds.length === 0) {
      return { content: [{ type: "text", text: "Nenhum produto cadastrado para este veículo." }], structuredContent: { results: [] } };
    }
    let prodQ = supabase
      .from("products")
      .select("id, sku, name, slug, short_description, price_b2c, sale_price_b2c, stock, brand:brands(name, slug)")
      .eq("active", true)
      .is("deleted_at", null)
      .in("id", productIds)
      .order("sales_count", { ascending: false })
      .limit(limit ?? 15);
    if (query) {
      const safe = sanitizeOrQuery(escapeLike(query));
      prodQ = prodQ.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,short_description.ilike.%${safe}%`);
    }
    const { data, error } = await prodQ;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const results = (data ?? []).map((product) => ({
      ...product,
      price: product.sale_price_b2c ?? product.price_b2c,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(results) }],
      structuredContent: { count: results.length, results },
    };
  },
});