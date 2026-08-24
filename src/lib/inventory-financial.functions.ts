import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { SUPPLY_APPROVE_ROLES, SUPPLY_READ_ROLES, SUPPLY_WRITE_ROLES, requireSupplyRole } from "./supplies.server";

export type InventoryFinancialPosition = {
  products_with_stock: number;
  valued_products: number;
  missing_cost_products: number;
  units_total: number;
  inventory_value: number;
  potential_revenue: number;
  potential_gross_profit: number;
  stock_divergence_products: number;
};

export type InventoryClosingResult = {
  ok: boolean;
  already_closed: boolean;
  closing_id: string;
  period_date: string;
  products_count?: number;
  units_total?: number;
  inventory_value?: number;
  missing_cost_products?: number;
};

type RpcResult = { ok: boolean; processed?: number; approved?: number; candidate_id?: string };

export const getInventoryFinancialPosition = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);
    const { data, error } = await sb.rpc("get_inventory_financial_position");
    if (error) throw new Error(error.message);
    return (data ?? {}) as InventoryFinancialPosition;
  });

export const listInventoryClosings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);
    const { data, error } = await sb.from("inventory_closings")
      .select("id, period_date, status, products_count, units_total, inventory_value, missing_cost_products, closed_at")
      .eq("tenant_id", context.tenantId).order("period_date", { ascending: false }).limit(24);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const closeInventoryPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { periodDate: string }) => input)
  .handler(async ({ data, context }): Promise<InventoryClosingResult> => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { data: result, error } = await sb.rpc("close_inventory_period", { p_period_date: data.periodDate });
    if (error) throw new Error(error.message);
    return result as unknown as InventoryClosingResult;
  });

export const listCostSanitationCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { status?: string; search?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);
    let query = sb.from("product_cost_candidates")
      .select("id, product_id, proposed_cost, source_type, source_reference, source_date, confidence, status, notes, current_price, suggested_price, projected_margin_rate, updated_at, product:products(id,name,sku,internal_code,manufacturer_code,stock,price_b2c)")
      .eq("tenant_id", context.tenantId)
      .eq("status", data.status || "awaiting_source")
      .order("updated_at", { ascending: false })
      .limit(300);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const term = (data.search ?? "").trim().toLowerCase();
    if (!term) return rows ?? [];
    return (rows ?? []).filter((row: any) => [row.product?.name,row.product?.sku,row.product?.internal_code,row.product?.manufacturer_code]
      .filter(Boolean).some((value: string) => value.toLowerCase().includes(term)));
  });

export const refreshCostSanitationQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RpcResult> => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);
    const { data, error } = await sb.rpc("refresh_cost_sanitation_queue");
    if (error) throw new Error(error.message);
    return data as unknown as RpcResult;
  });

export const proposeManualProductCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string; cost: number; evidence: string; notes?: string }) => input)
  .handler(async ({ data, context }): Promise<RpcResult> => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);
    const { data: result, error } = await sb.rpc("propose_manual_product_cost", {
      p_product_id: data.productId, p_cost: data.cost, p_evidence_reference: data.evidence, p_notes: data.notes || null,
    });
    if (error) throw new Error(error.message);
    return result as unknown as RpcResult;
  });

export const approveProductCostCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[] }) => input)
  .handler(async ({ data, context }): Promise<RpcResult> => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { data: result, error } = await sb.rpc("approve_product_cost_candidates", { p_candidate_ids: data.ids });
    if (error) throw new Error(error.message);
    return result as unknown as RpcResult;
  });
