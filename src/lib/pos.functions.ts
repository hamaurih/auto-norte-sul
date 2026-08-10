import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

export type PosPaymentMethod =
  | "cash" | "pix" | "debit_card" | "credit_card" | "store_credit" | "b2b_invoice";
export type PosCashMovementType = "supply" | "withdrawal";

export const getOpenCashSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { terminalCode: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await tdb(context.supabase)
      .from("pos_cash_sessions")
      .select("id, tenant_id, branch_id, warehouse_id, terminal_code, operator_id, opening_amount, opened_at, status")
      .eq("tenant_id", context.tenantId)
      .eq("terminal_code", data.terminalCode.trim().toUpperCase())
      .eq("operator_id", context.userId)
      .eq("status", "open")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const openCashSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { branchId: string; warehouseId: string; terminalCode: string; openingAmount: number }) => input)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await tdb(context.supabase).rpc("open_pos_cash_session", {
      p_tenant_id: context.tenantId, p_branch_id: data.branchId, p_warehouse_id: data.warehouseId,
      p_terminal_code: data.terminalCode, p_opening_amount: data.openingAmount,
    });
    if (error) throw new Error(error.message);
    return row;
  });

export const listPdvCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { warehouseId: string; search?: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const { data: membership } = await sb.from("tenant_memberships").select("id")
      .eq("tenant_id", context.tenantId).eq("user_id", context.userId).eq("active", true).maybeSingle();
    if (!membership) throw new Error("Usuário sem acesso ativo a esta empresa");
    const { data: stock, error } = await sb.from("product_stock")
      .select("product_id, on_hand, reserved, product:products(id, sku, internal_code, name, price_b2c, sale_price_b2c, active)")
      .eq("tenant_id", context.tenantId).eq("warehouse_id", data.warehouseId).gt("on_hand", 0).limit(300);
    if (error) throw new Error(error.message);
    const term = (data.search ?? "").trim().toLocaleLowerCase("pt-BR");
    return (stock ?? []).map((row: any) => ({
      ...row.product, stock: Math.max(0, Number(row.on_hand ?? 0) - Number(row.reserved ?? 0)),
    })).filter((p: any) => p.active && p.stock > 0 && (!term ||
      [p.name, p.sku, p.internal_code ?? ""].some((v: string) => v.toLocaleLowerCase("pt-BR").includes(term))
    )).slice(0, 20);
  });

export const finalizePosSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    cashSessionId: string; idempotencyKey: string;
    items: Array<{ product_id: string; quantity: number }>;
    payments: Array<{ method: PosPaymentMethod; amount: number; installments?: number; provider?: string; provider_reference?: string }>;
    discountAmount?: number; customerId?: string;
  }) => input)
  .handler(async ({ data, context }) => {
    const { data: saleId, error } = await tdb(context.supabase).rpc("finalize_pos_sale", {
      p_tenant_id: context.tenantId, p_cash_session_id: data.cashSessionId,
      p_idempotency_key: data.idempotencyKey, p_items: data.items, p_payments: data.payments,
      p_discount_amount: data.discountAmount ?? 0, p_customer_id: data.customerId ?? null,
    });
    if (error) throw new Error(error.message);
    return { saleId: saleId as string };
  });

export const recordCashMovement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string; type: PosCashMovementType; amount: number; reason: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await tdb(context.supabase).rpc("record_pos_cash_movement", {
      p_session_id: data.sessionId, p_type: data.type, p_amount: data.amount, p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return row;
  });

export const closeCashSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string; countedAmount: number; notes?: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await tdb(context.supabase).rpc("close_pos_cash_session", {
      p_session_id: data.sessionId, p_counted_amount: data.countedAmount, p_notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    return row;
  });
