import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "find_by_vehicle",
  title: "Find products by vehicle",
  description:
    "Find products that fit a specific vehicle (make, model and optional year). Use when a customer describes their car, e.g. 'Onix 2020'. Combine with a category or query filter to narrow the result.",
  inputSchema: {
    make: z.string().trim().min(1).describe("Vehicle make, e.g. 'Chevrolet'."),
    model: z.string().trim().min(1).optional().describe("Vehicle model, e.g. 'Onix'."),
    year: z.number().int().min(1950).max(2100).optional().describe("Vehicle model year."),
    query: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional text filter applied to product name/SKU (e.g. 'pastilha de freio')."),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ make, model, year, query, limit }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { "x-tenant-slug": process.env.PUBLIC_TENANT_SLUG ?? "norte-sul-real" } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    let appQ = supabase
      .from("product_applications")
      .select("product_id, vehicle_make, vehicle_model, year_from, year_to")
      .ilike("vehicle_make", `%${make}%`);
    if (model) appQ = appQ.ilike("vehicle_model", `%${model}%`);
    const { data: apps, error: appErr } = await appQ.limit(500);
    if (appErr) return { content: [{ type: "text", text: appErr.message }], isError: true };
    let productIds = Array.from(new Set((apps ?? []).map((a) => a.product_id)));
    if (year) {
      const matching = new Set(
        (apps ?? [])
          .filter(
            (a) =>
              (a.year_from == null || year >= a.year_from) &&
              (a.year_to == null || year <= a.year_to),
          )
          .map((a) => a.product_id),
      );
      productIds = productIds.filter((id) => matching.has(id));
    }
    if (productIds.length === 0) {
      return {
        content: [{ type: "text", text: "Nenhum produto cadastrado para este veículo." }],
        structuredContent: { results: [] },
      };
    }
    let prodQ = supabase
      .from("products")
      .select(
        "id, sku, name, slug, short_description, price_b2c, sale_price_b2c, stock, brand:brands(name, slug)",
      )
      .eq("active", true)
      .in("id", productIds)
      .order("sales_count", { ascending: false })
      .limit(limit ?? 15);
    if (query) {
      const safe = query.replace(/[,()]/g, " ");
      prodQ = prodQ.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,short_description.ilike.%${safe}%`);
    }
    const { data, error } = await prodQ;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const results = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(results) }],
      structuredContent: { count: results.length, results },
    };
  },
});
