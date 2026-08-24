import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { SUPPLY_APPROVE_ROLES, SUPPLY_READ_ROLES, requireSupplyRole } from "./supplies.server";

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
    const { data, error } = await sb
      .from("inventory_closings")
      .select("id, period_date, status, products_count, units_total, inventory_value, missing_cost_products, closed_at")
      .eq("tenant_id", context.tenantId)
      .order("period_date", { ascending: false })
      .limit(24);
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
