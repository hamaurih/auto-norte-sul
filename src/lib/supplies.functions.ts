import { createServerFn } from "@tanstack/react-start";
import { buildProductSearchFilter } from "@/lib/product-codes";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import {
  SUPPLY_APPROVE_ROLES,
  SUPPLY_PRODUCT_SELECT,
  SUPPLY_READ_ROLES,
  SUPPLY_WRITE_ROLES,
  escapeLike,
  lineTotal,
  mapSupplyProduct,
  normalizeItems,
  orderTotals,
  requireSupplyRole,
  round2,
  type SupplyOrderItemInput,
} from "./supplies.server";

export type SupplierInput = {
  id?: string;
  legal_name: string;
  trade_name?: string | null;
  tax_id?: string | null;
  state_tax_id?: string | null
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  contact_name?: string | null;
  average_lead_days?: number | null;
  payment_terms?: string | null;
  notes?: string | null;
  active?: boolean;
};

export type ReceiptRpcResult = {
  ok?: boolean;
  status?: string;
  receipt_id?: string;
  already_confirmed?: boolean;
  already_reversed?: boolean;
  accepted_total?: number;
  purchase_order_status?: string;
};

export type PurchaseOrderStatus =
  | "draft"
  | "approved"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled";

// ===================== Fornecedores =====================

export const listSuppliers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { search?: string; onlyActive?: boolean }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);

    let query = sb
      .from("suppliers")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("legal_name", { ascending: true })
      .limit(300);

    if (data.onlyActive) query = query.eq("active", true);
    const term = escapeLike(data.search ?? "");
    if (term) query = query.or(`legal_name.ilike.%${term}%,trade_name.ilike.%${term}%,tax_id.ilike.%${term}%`);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getSupplier = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);
    const { data: row, error } = await sb
      .from("suppliers")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Fornecedor não encontrado");
    return row;
  });

export const upsertSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SupplierInput) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);

    const legalName = (data.legal_name ?? "").trim();
    if (legalName.length < 3) throw new Error("Razão social deve ter ao menos 3 caracteres");

    const row = {
      legal_name: legalName,
      trade_name: data.trade_name?.trim() || null,
      tax_id: data.tax_id?.replace(/\D/g, "") || null,
      state_tax_id: data.state_tax_id?.trim() || null,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      whatsapp: data.whatsapp?.trim() || null,
      address: data.address?.trim() || null,
      city: data.city?.trim() || null,
      state: data.state?.trim().toUpperCase() || null,
      zip_code: data.zip_code?.replace(/\D/g, "") || null,
      contact_name: data.contact_name?.trim() || null,
      average_lead_days:
        data.average_lead_days == null || Number.isNaN(Number(data.average_lead_days))
          ? null
          : Math.max(0, Math.trunc(Number(data.average_lead_days))),
      payment_terms: data.payment_terms?.trim() || null,
      notes: data.notes?.trim() || null,
      active: data.active ?? true,
      updated_by: context.userId,
    };

    if (data.id) {
      const { error } = await sb
        .from("suppliers")
        .update(row)
        .eq("id", data.id)
        .eq("tenant_id", context.tenantId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }

    const { data: inserted, error } = await sb
      .from("suppliers")
      .insert({ ...row, tenant_id: context.tenantId, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id as string };
  });

export const setSupplierActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; active: boolean }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);
    const { error } = await sb
      .from("suppliers")
      .update({ active: data.active, updated_by: context.userId })
      .eq("id", data.id)
      .eq("tenant_id", context.tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);

    const { count, error: countError } = await sb
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.tenantId)
      .eq("supplier_id", data.id);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0) {
      throw new Error("Fornecedor possui pedidos de compra; desative em vez de excluir");
    }

    const { error } = await sb.from("suppliers").delete().eq("id", data.id).eq("tenant_id", context.tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===================== Apoio (depósitos e produtos) =====================

export const listSupplyWarehouses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);
    const { data, error } = await sb
      .from("warehouses")
      .select("id, name, code, is_default, active, branch:branches(id, name, code)")
      .eq("tenant_id", context.tenantId)
      .eq("active", true)
      .order("is_default", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      id: row.id as string,
      name: row.name as string,
      code: row.code as string,
      is_default: Boolean(row.is_default),
      branch_name: (row.branch?.name ?? null) as string | null,
    }));
  });

export const searchSupplyProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { search: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);

    const term = escapeLike(data.search ?? "");
    if (term.length < 2) return [];

    const { data: rows, error } = await sb
      .from("products")
      .select(SUPPLY_PRODUCT_SELECT)
      .eq("tenant_id", context.tenantId)
      .eq("active", true)
      .or(buildProductSearchFilter(term) ?? `name.ilike.%${term}%`)
      .order("name")
      .limit(25);
    if (error) throw new Error(error.message);
    return (rows ?? []).map(mapSupplyProduct);
  });

// ===================== Pedidos de compra =====================

const ORDER_SELECT =
  "id, number, status, issued_at, expected_at, payment_terms, freight_amount, discount_amount, other_amount, items_total, total_amount, notes, warehouse_id, supplier_id, approved_at, sent_at, cancelled_at, cancel_reason, created_at, supplier:suppliers(id, legal_name, trade_name, tax_id), warehouse:warehouses(id, name, code)";

export const listPurchaseOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { status?: PurchaseOrderStatus | "open" | "all"; search?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);

    let query = sb
      .from("purchase_orders")
      .select(ORDER_SELECT)
      .eq("tenant_id", context.tenantId)
      .order("number", { ascending: false })
      .limit(200);

    if (data.status === "open") {
      query = query.in("status", ["draft", "approved", "sent", "partially_received"]);
    } else if (data.status && data.status !== "all") {
      query = query.eq("status", data.status);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const term = (data.search ?? "").trim().toLowerCase();
    const list = rows ?? [];
    if (!term) return list;
    return list.filter((row: any) =>
      [row.number?.toString(), row.supplier?.legal_name, row.supplier?.trade_name]
        .filter(Boolean)
        .some((value: string) => value.toLowerCase().includes(term)),
    );
  });

export const getPurchaseOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);

    const { data: order, error } = await sb
      .from("purchase_orders")
      .select(ORDER_SELECT)
      .eq("tenant_id", context.tenantId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Pedido de compra não encontrado");

    const { data: items, error: itemsError } = await sb
      .from("purchase_order_items")
      .select(
        "id, product_id, ordered_qty, received_qty, unit_cost, discount_amount, tax_amount, line_total, notes, product:products(id, sku, name, internal_code, manufacturer_code)",
      )
      .eq("tenant_id", context.tenantId)
      .eq("purchase_order_id", data.id)
      .order("created_at");
    if (itemsError) throw new Error(itemsError.message);

    const { data: receipts, error: receiptsError } = await sb
      .from("goods_receipts")
      .select("id, number, status, received_at, invoice_number, confirmed_at, reversed_at")
      .eq("tenant_id", context.tenantId)
      .eq("purchase_order_id", data.id)
      .order("number", { ascending: false });
    if (receiptsError) throw new Error(receiptsError.message);

    return { order, items: items ?? [], receipts: receipts ?? [] };
  });

export const savePurchaseOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string;
      supplier_id: string;
      warehouse_id: string;
      expected_at?: string | null;
      payment_terms?: string | null;
      freight_amount?: number;
      discount_amount?: number;
      other_amount?: number;
      notes?: string | null;
      items: SupplyOrderItemInput[];
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);

    if (!data.supplier_id) throw new Error("Selecione o fornecedor");
    if (!data.warehouse_id) throw new Error("Selecione o depósito de entrada");

    const items = normalizeItems(data.items ?? []);
    const totals = orderTotals(items, {
      freight_amount: data.freight_amount,
      discount_amount: data.discount_amount,
      other_amount: data.other_amount,
    });

    const header = {
      supplier_id: data.supplier_id,
      warehouse_id: data.warehouse_id,
      expected_at: data.expected_at || null,
      payment_terms: data.payment_terms?.trim() || null,
      freight_amount: round2(Number(data.freight_amount ?? 0)),
      discount_amount: round2(Number(data.discount_amount ?? 0)),
      other_amount: round2(Number(data.other_amount ?? 0)),
      items_total: totals.itemsTotal,
      total_amount: totals.total,
      notes: data.notes?.trim() || null,
      updated_by: context.userId,
    };

    let orderId = data.id;

    if (orderId) {
      const { data: current, error: currentError } = await sb
        .from("purchase_orders")
        .select("id, status")
        .eq("tenant_id", context.tenantId)
        .eq("id", orderId)
        .maybeSingle();
      if (currentError) throw new Error(currentError.message);
      if (!current) throw new Error("Pedido de compra não encontrado");
      if (current.status !== "draft") throw new Error("Somente pedidos em rascunho podem ser editados");

      const { error } = await sb
        .from("purchase_orders")
        .update(header)
        .eq("id", orderId)
        .eq("tenant_id", context.tenantId);
      if (error) throw new Error(error.message);

      const { error: deleteError } = await sb
        .from("purchase_order_items")
        .delete()
        .eq("tenant_id", context.tenantId)
        .eq("purchase_order_id", orderId);
      if (deleteError) throw new Error(deleteError.message);
    } else {
      const { data: inserted, error } = await sb
        .from("purchase_orders")
        .insert({
          ...header,
          tenant_id: context.tenantId,
          status: "draft",
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      orderId = inserted.id as string;
    }

    const { error: itemsError } = await sb.from("purchase_order_items").insert(
      items.map((item) => ({
        tenant_id: context.tenantId,
        purchase_order_id: orderId,
        product_id: item.product_id,
        ordered_qty: item.ordered_qty,
        unit_cost: item.unit_cost,
        discount_amount: round2(Number(item.discount_amount ?? 0)),
        tax_amount: round2(Number(item.tax_amount ?? 0)),
        line_total: lineTotal(item),
        notes: item.notes ?? null,
      })),
    );
    if (itemsError) throw new Error(itemsError.message);

    return { ok: true, id: orderId as string };
  });

export const setPurchaseOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "approved" | "sent" | "cancelled"; reason?: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const roles = data.status === "sent" ? SUPPLY_WRITE_ROLES : SUPPLY_APPROVE_ROLES;
    await requireSupplyRole(sb, context.userId, context.tenantId, roles);

    const { data: order, error } = await sb
      .from("purchase_orders")
      .select("id, status, tenant_id")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Pedido de compra não encontrado");

    const allowed: Record<string, string[]> = {
      approved: ["draft"],
      sent: ["approved"],
      cancelled: ["draft", "approved", "sent"],
    };
    if (!allowed[data.status].includes(order.status)) {
      throw new Error(`Transição inválida: ${order.status} → ${data.status}`);
    }
    if (data.status === "cancelled" && !(data.reason ?? "").trim()) {
      throw new Error("Informe o motivo do cancelamento");
    }

    const patch: Record<string, unknown> = { status: data.status, updated_by: context.userId };
    if (data.status === "approved") {
      patch.approved_at = new Date().toISOString();
      patch.approved_by = context.userId;
    }
    if (data.status === "sent") patch.sent_at = new Date().toISOString();
    if (data.status === "cancelled") {
      patch.cancelled_at = new Date().toISOString();
      patch.cancelled_by = context.userId;
      patch.cancel_reason = (data.reason ?? "").trim();
    }

    const { error: updateError } = await sb
      .from("purchase_orders")
      .update(patch)
      .eq("id", data.id)
      .eq("tenant_id", context.tenantId);
    if (updateError) throw new Error(updateError.message);

    return { ok: true, status: data.status };
  });

// ===================== Recebimentos =====================

const RECEIPT_SELECT =
  "id, number, status, received_at, invoice_number, notes, warehouse_id, purchase_order_id, confirmed_at, reversed_at, reverse_reason, created_at, supplier:suppliers(id, legal_name, trade_name), warehouse:warehouses(id, name, code), purchase_order:purchase_orders(id, number, status)";

export const listGoodsReceipts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { status?: "draft" | "confirmed" | "reversed" | "all" }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);

    let query = sb
      .from("goods_receipts")
      .select(RECEIPT_SELECT)
      .eq("tenant_id", context.tenantId)
      .order("number", { ascending: false })
      .limit(200);
    if (data.status && data.status !== "all") query = query.eq("status", data.status);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getGoodsReceipt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);

    const { data: receipt, error } = await sb
      .from("goods_receipts")
      .select(RECEIPT_SELECT)
      .eq("tenant_id", context.tenantId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!receipt) throw new Error("Recebimento não encontrado");

    const { data: items, error: itemsError } = await sb
      .from("goods_receipt_items")
      .select(
        "id, product_id, accepted_qty, rejected_qty, unit_cost, notes, purchase_order_item_id, product:products(id, sku, name, internal_code, manufacturer_code)",
      )
      .eq("tenant_id", context.tenantId)
      .eq("goods_receipt_id", data.id)
      .order("created_at");
    if (itemsError) throw new Error(itemsError.message);

    return { receipt, items: items ?? [] };
  });

export const createGoodsReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      purchase_order_id: string;
      received_at?: string | null;
      invoice_number?: string | null;
      notes?: string | null;
      items: {
        purchase_order_item_id: string;
        accepted_qty: number;
        rejected_qty?: number;
        unit_cost: number;
        notes?: string | null;
      }[];
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);

    const { data: order, error: orderError } = await sb
      .from("purchase_orders")
      .select("id, status, supplier_id, warehouse_id")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.purchase_order_id)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido de compra não encontrado");
    if (!["approved", "sent", "partially_received"].includes(order.status)) {
      throw new Error(`Pedido com status ${order.status} não aceita recebimento`);
    }

    const { data: orderItems, error: itemsError } = await sb
      .from("purchase_order_items")
      .select("id, product_id, ordered_qty, received_qty, unit_cost")
      .eq("tenant_id", context.tenantId)
      .eq("purchase_order_id", order.id);
    if (itemsError) throw new Error(itemsError.message);

    const byId = new Map((orderItems ?? []).map((item: any) => [item.id as string, item]));
    const rows: Record<string, unknown>[] = [];

    for (const raw of data.items ?? []) {
      const orderItem = byId.get(raw.purchase_order_item_id);
      if (!orderItem) throw new Error("Item informado não pertence a este pedido");

      const accepted = Number(raw.accepted_qty ?? 0);
      const rejected = Number(raw.rejected_qty ?? 0);
      if (accepted < 0 || rejected < 0) throw new Error("Quantidades não podem ser negativas");
      if (accepted === 0 && rejected === 0) continue;

      const pending = Number(orderItem.ordered_qty) - Number(orderItem.received_qty);
      if (accepted > pending + 1e-6) {
        throw new Error(`Quantidade aceita acima do saldo pendente (${pending}) do item`);
      }

      const unitCost = Number(raw.unit_cost ?? orderItem.unit_cost ?? 0);
      if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("Custo efetivo inválido");

      rows.push({
        tenant_id: context.tenantId,
        purchase_order_item_id: orderItem.id,
        product_id: orderItem.product_id,
        accepted_qty: accepted,
        rejected_qty: rejected,
        unit_cost: unitCost,
        notes: raw.notes?.trim() || null,
      });
    }

    if (rows.length === 0) throw new Error("Informe ao menos uma quantidade recebida ou recusada");

    const { data: receipt, error: receiptError } = await sb
      .from("goods_receipts")
      .insert({
        tenant_id: context.tenantId,
        purchase_order_id: order.id,
        supplier_id: order.supplier_id,
        warehouse_id: order.warehouse_id,
        status: "draft",
        received_at: data.received_at || new Date().toISOString().slice(0, 10),
        invoice_number: data.invoice_number?.trim() || null,
        notes: data.notes?.trim() || null,
        created_by: context.userId,
      })
      .select("id, number")
      .single();
    if (receiptError) throw new Error(receiptError.message);

    const { error: insertItemsError } = await sb
      .from("goods_receipt_items")
      .insert(rows.map((row) => ({ ...row, goods_receipt_id: receipt.id })));
    if (insertItemsError) {
      await sb.from("goods_receipts").delete().eq("id", receipt.id).eq("tenant_id", context.tenantId);
      throw new Error(insertItemsError.message);
    }

    return { ok: true, id: receipt.id as string, number: receipt.number as number };
  });

export const confirmGoodsReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);
    const { data: result, error } = await sb.rpc("confirm_goods_receipt", { p_receipt_id: data.id });
    if (error) throw new Error(error.message);
    return (result ?? {}) as ReceiptRpcResult;
  });

export const reverseGoodsReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    if (!(data.reason ?? "").trim()) throw new Error("Informe o motivo do estorno");
    const { data: result, error } = await sb.rpc("reverse_goods_receipt", {
      p_receipt_id: data.id,
      p_reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return (result ?? {}) as ReceiptRpcResult;
  });

// ===================== Visão geral do módulo =====================

export const getSuppliesOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [suppliers, openOrders, awaiting, draftReceipts, openValue, purchased, recent] = await Promise.all([
      sb
        .from("suppliers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .eq("active", true),
      sb
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .in("status", ["draft", "approved", "sent", "partially_received"]),
      sb
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .in("status", ["approved", "sent", "partially_received"]),
      sb
        .from("goods_receipts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .eq("status", "draft"),
      sb
        .from("purchase_orders")
        .select("total_amount")
        .eq("tenant_id", context.tenantId)
        .in("status", ["approved", "sent", "partially_received"]),
      sb
        .from("purchase_orders")
        .select("total_amount")
        .eq("tenant_id", context.tenantId)
        .in("status", ["partially_received", "received"])
        .gte("created_at", since),
      sb
        .from("goods_receipts")
        .select(
          "id, number, status, received_at, confirmed_at, invoice_number, supplier:suppliers(legal_name), purchase_order:purchase_orders(number)",
        )
        .eq("tenant_id", context.tenantId)
        .order("number", { ascending: false })
        .limit(5),
    ]);

    const sum = (rows: any[] | null) =>
      round2((rows ?? []).reduce((acc: number, row: any) => acc + Number(row.total_amount ?? 0), 0));

    return {
      activeSuppliers: suppliers.error ? null : suppliers.count ?? 0,
      openOrders: openOrders.error ? null : openOrders.count ?? 0,
      awaitingReceipt: awaiting.error ? null : awaiting.count ?? 0,
      pendingReceipts: draftReceipts.error ? null : draftReceipts.count ?? 0,
      openOrdersValue: openValue.error ? null : sum(openValue.data as any[]),
      purchasedValue30d: purchased.error ? null : sum(purchased.data as any[]),
      recentReceipts: recent.error ? [] : (recent.data ?? []),
    };
  });
