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

export type PdvCatalogProduct = {
  id: string;
  sku: string;
  internal_code: string | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  image_url: string | null;
  price_b2c: number;
  sale_price_b2c: number | null;
  stock: number;
};

export const listPdvCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { warehouseId: string; search?: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const { data: membership } = await sb.from("tenant_memberships").select("id")
      .eq("tenant_id", context.tenantId).eq("user_id", context.userId).eq("active", true).maybeSingle();
    if (!membership) throw new Error("Usuário sem acesso ativo a esta empresa");
    const select =
      "product_id, on_hand, reserved, product:products(id, sku, internal_code, name, price_b2c, sale_price_b2c, active, brand:brands(name), images:product_images(url, is_primary, sort_order))";
    const { data: stock, error } = await sb.from("product_stock")
      .select(select)
      .eq("tenant_id", context.tenantId).eq("warehouse_id", data.warehouseId).gt("on_hand", 0).limit(300);
    if (error) throw new Error(error.message);
    const term = (data.search ?? "").trim().toLocaleLowerCase("pt-BR");
    return (stock ?? []).map((row: any) => {
      const p = row.product ?? {};
      const images = [...(p.images ?? [])].sort(
        (a: any, b: any) =>
          Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) ||
          Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
      );
      return {
        id: p.id, sku: p.sku, internal_code: p.internal_code ?? null,
        barcode: p.barcode ?? null, name: p.name, brand: p.brand?.name ?? null,
        image_url: images[0]?.url ?? null,
        price_b2c: Number(p.price_b2c ?? 0),
        sale_price_b2c: p.sale_price_b2c == null ? null : Number(p.sale_price_b2c),
        active: p.active,
        stock: Math.max(0, Number(row.on_hand ?? 0) - Number(row.reserved ?? 0)),
      };
    }).filter((p: any) => p.active && p.stock > 0 && (!term ||
      [p.name, p.sku, p.internal_code ?? "", p.barcode ?? ""]
        .some((v: string) => v.toLocaleLowerCase("pt-BR").includes(term))
    )).slice(0, 20) as PdvCatalogProduct[];
  });

/**
 * Busca por código exato (código de barras, SKU ou código interno).
 * Retorna todas as correspondências — o cliente nunca escolhe silenciosamente.
 */
export const findPdvProductsByCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { warehouseId: string; code: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const { data: membership } = await sb.from("tenant_memberships").select("id")
      .eq("tenant_id", context.tenantId).eq("user_id", context.userId).eq("active", true).maybeSingle();
    if (!membership) throw new Error("Usuário sem acesso ativo a esta empresa");

    const code = data.code.trim();
    if (!code) return [] as PdvCatalogProduct[];

    const { data: products, error } = await sb.from("products")
      .select("id, sku, internal_code, name, price_b2c, sale_price_b2c, active, brand:brands(name), images:product_images(url, is_primary, sort_order)")
      .eq("tenant_id", context.tenantId)
      .eq("active", true)
      .or(`sku.ilike.${code},internal_code.ilike.${code}`)
      .limit(20);
    if (error) throw new Error(error.message);
    const rows = products ?? [];
    if (rows.length === 0) return [] as PdvCatalogProduct[];

    const { data: stock, error: stockError } = await sb.from("product_stock")
      .select("product_id, on_hand, reserved")
      .eq("tenant_id", context.tenantId)
      .eq("warehouse_id", data.warehouseId)
      .in("product_id", rows.map((p: any) => p.id));
    if (stockError) throw new Error(stockError.message);
    const stockMap = new Map(
      (stock ?? []).map((s: any) => [
        s.product_id,
        Math.max(0, Number(s.on_hand ?? 0) - Number(s.reserved ?? 0)),
      ]),
    );

    return rows.map((p: any) => {
      const images = [...(p.images ?? [])].sort(
        (a: any, b: any) =>
          Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) ||
          Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
      );
      return {
        id: p.id, sku: p.sku, internal_code: p.internal_code ?? null,
        barcode: p.barcode ?? null, name: p.name, brand: p.brand?.name ?? null,
        image_url: images[0]?.url ?? null,
        price_b2c: Number(p.price_b2c ?? 0),
        sale_price_b2c: p.sale_price_b2c == null ? null : Number(p.sale_price_b2c),
        stock: stockMap.get(p.id) ?? 0,
      };
    }) as PdvCatalogProduct[];
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
