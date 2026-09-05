import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

async function requirePricingRole(supabase: any, userId: string, tenantId: string) {
  const { data, error } = await supabase.from("tenant_memberships").select("role").eq("tenant_id", tenantId).eq("user_id", userId).eq("active", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !["owner", "admin", "manager"].includes(data.role)) throw new Error("Sem permissão para alterar preços");
}

export const getPricingCenter = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const sb = tdb(context.supabase);
  await requirePricingRole(sb, context.userId, context.tenantId);
  const [settings, summary, brands, categories, history] = await Promise.all([
    sb.from("tenant_pricing_settings").select("default_b2c_markup_pct,price_rounding,auto_recalculate_b2c").eq("tenant_id", context.tenantId).maybeSingle(),
    sb.rpc("get_pricing_center_summary", { p_tenant_id: context.tenantId }),
    sb.from("brands").select("id,name").eq("tenant_id", context.tenantId).order("name"),
    sb.from("categories").select("id,name,parent_id").eq("tenant_id", context.tenantId).order("name"),
    sb.from("price_adjustment_batches").select("id,target,adjustment_pct,affected_count,average_before,average_after,created_at").eq("tenant_id", context.tenantId).order("created_at", { ascending: false }).limit(10),
  ]);
  for (const result of [settings, summary, brands, categories, history]) if (result.error) throw new Error(result.error.message);
  return {
    settings: settings.data ?? { default_b2c_markup_pct: 0, price_rounding: "cent", auto_recalculate_b2c: true },
    summary: summary.data ?? { total: 0, active: 0, withB2b: 0, avgB2b: 0, avgB2c: 0, exceptions: 0 },
    brands: brands.data ?? [], categories: categories.data ?? [], history: history.data ?? [],
  };
});

export const searchPricingProducts = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).inputValidator((input?: { search?: string; limit?: number }) => input ?? {}).handler(async ({ data, context }) => {
  const sb = tdb(context.supabase);
  await requirePricingRole(sb, context.userId, context.tenantId);
  const search = String(data.search ?? "").trim();
  const limit = Math.max(1, Math.min(Number(data.limit ?? 25), 50));
  let query = sb.from("products").select("id,sku,internal_code,manufacturer_code,name,price_b2b,price_b2c,brand_id,category_id,active").eq("tenant_id", context.tenantId).is("deleted_at", null).order("name").limit(limit);
  if (search) {
    const safe = search.replace(/[,()*%\\"']/g, " ").replace(/\s+/g, " ").trim();
    query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,internal_code.ilike.%${safe}%,manufacturer_code.ilike.%${safe}%`);
  }
  const products = await query;
  if (products.error) throw new Error(products.error.message);
  const ids = (products.data ?? []).map((p: any) => p.id);
  const rules = ids.length ? await sb.from("product_b2c_price_rules").select("product_id,mode,markup_pct,manual_b2c_price").eq("tenant_id", context.tenantId).in("product_id", ids) : { data: [], error: null } as any;
  if (rules.error) throw new Error(rules.error.message);
  const ruleMap = new Map((rules.data ?? []).map((r: any) => [r.product_id, r]));
  return (products.data ?? []).map((p: any) => ({ ...p, rule: ruleMap.get(p.id) ?? { mode: "global", markup_pct: null, manual_b2c_price: null } }));
});

export const saveGlobalPricing = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: { markupPct: number; rounding: "cent" | "x90" | "x99" | "whole"; recalculate?: boolean }) => input).handler(async ({ data, context }) => {
  const sb = tdb(context.supabase); await requirePricingRole(sb, context.userId, context.tenantId);
  const result = await sb.rpc("set_global_b2c_markup", { p_tenant_id: context.tenantId, p_markup_pct: Number(data.markupPct), p_rounding: data.rounding, p_recalculate: data.recalculate !== false });
  if (result.error) throw new Error(result.error.message); return result.data;
});

export const saveProductPricingRule = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: { productId: string; mode: "global" | "markup" | "manual"; markupPct?: number | null; manualPrice?: number | null }) => input).handler(async ({ data, context }) => {
  const sb = tdb(context.supabase); await requirePricingRole(sb, context.userId, context.tenantId);
  const result = await sb.rpc("set_product_b2c_rule", { p_tenant_id: context.tenantId, p_product_id: data.productId, p_mode: data.mode, p_markup_pct: data.mode === "markup" ? Number(data.markupPct ?? 0) : null, p_manual_price: data.mode === "manual" ? Number(data.manualPrice ?? 0) : null });
  if (result.error) throw new Error(result.error.message); return result.data;
});

export const previewPricingAdjustment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: { target: "b2b" | "b2c"; percentage: number; brandId?: string | null; categoryId?: string | null; onlyActive?: boolean }) => input).handler(async ({ data, context }) => {
  const sb = tdb(context.supabase); await requirePricingRole(sb, context.userId, context.tenantId);
  const result = await sb.rpc("preview_price_adjustment", { p_tenant_id: context.tenantId, p_target: data.target, p_percentage: Number(data.percentage), p_brand_id: data.brandId || null, p_category_id: data.categoryId || null, p_only_active: data.onlyActive !== false });
  if (result.error) throw new Error(result.error.message); return result.data;
});

export const applyPricingAdjustment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: { requestId: string; target: "b2b" | "b2c"; percentage: number; brandId?: string | null; categoryId?: string | null; onlyActive?: boolean }) => input).handler(async ({ data, context }) => {
  const sb = tdb(context.supabase); await requirePricingRole(sb, context.userId, context.tenantId);
  const result = await sb.rpc("apply_price_adjustment", { p_tenant_id: context.tenantId, p_request_id: data.requestId, p_target: data.target, p_percentage: Number(data.percentage), p_brand_id: data.brandId || null, p_category_id: data.categoryId || null, p_only_active: data.onlyActive !== false });
  if (result.error) throw new Error(result.error.message); return result.data;
});