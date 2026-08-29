import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

const DISPATCH_ROLES = ["owner", "admin", "manager", "stock"];

async function requireDispatchRole(sb: any, userId: string, tenantId: string) {
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);

  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: string }) => DISPATCH_ROLES.includes(item.role));
  if (!membership) throw new Error("Usuário sem permissão para conferir saída");
  return membership;
}

const orderIdInput = (input: { orderId: string }) => {
  if (!input?.orderId || !/^[0-9a-f-]{36}$/i.test(input.orderId)) {
    throw new Error("Pedido inválido");
  }
  return input;
};

export const getOrderDispatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(orderIdInput)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireDispatchRole(sb, context.userId, context.tenantId);

    const { data: dispatch, error: dispatchError } = await sb
      .from("order_dispatches")
      .select("id, order_id, status, started_at, started_by, started_by_name, completed_at, completed_by, completed_by_name")
      .eq("tenant_id", context.tenantId)
      .eq("order_id", data.orderId)
      .maybeSingle();

    if (dispatchError) throw new Error(dispatchError.message);
    if (!dispatch) return { dispatch: null, items: [] };

    const { data: rawItems, error: itemsError } = await sb
      .from("order_dispatch_items")
      .select("id, order_item_id, product_id, expected_qty, scanned_qty, last_scanned_at")
      .eq("tenant_id", context.tenantId)
      .eq("dispatch_id", dispatch.id)
      .order("created_at");

    if (itemsError) throw new Error(itemsError.message);

    const itemRows = rawItems ?? [];
    const orderItemIds = itemRows.map((item: any) => item.order_item_id);
    const productIds = itemRows.map((item: any) => item.product_id);

    const [orderItemsResult, productsResult] = await Promise.all([
      orderItemIds.length
        ? sb.from("order_items").select("id, name, sku").eq("tenant_id", context.tenantId).in("id", orderItemIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length
        ? sb.from("products").select("id, internal_code, manufacturer_code, gtin").eq("tenant_id", context.tenantId).in("id", productIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (orderItemsResult.error) throw new Error(orderItemsResult.error.message);
    if (productsResult.error) throw new Error(productsResult.error.message);

    const orderItemById = new Map((orderItemsResult.data ?? []).map((item: any) => [item.id, item]));
    const productById = new Map((productsResult.data ?? []).map((item: any) => [item.id, item]));

    return {
      dispatch,
      items: itemRows.map((item: any) => ({
        ...item,
        name: orderItemById.get(item.order_item_id)?.name ?? "Produto sem nome",
        sku: orderItemById.get(item.order_item_id)?.sku ?? "",
        internal_code: productById.get(item.product_id)?.internal_code ?? null,
        manufacturer_code: productById.get(item.product_id)?.manufacturer_code ?? null,
        gtin: productById.get(item.product_id)?.gtin ?? null,
      })),
    };
  });

export const startOrderDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(orderIdInput)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("internal_start_order_dispatch", {
      p_order_id: data.orderId,
      p_actor_user_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return result as any;
  });

export const scanOrderDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dispatchId: string; code: string; quantity?: number }) => {
    if (!input?.dispatchId || !/^[0-9a-f-]{36}$/i.test(input.dispatchId)) throw new Error("Conferência inválida");
    const code = String(input.code ?? "").trim();
    if (!code || code.length > 120) throw new Error("Informe um código válido");
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error("Quantidade inválida");
    return { dispatchId: input.dispatchId, code, quantity };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("internal_scan_order_dispatch", {
      p_dispatch_id: data.dispatchId,
      p_code: data.code,
      p_quantity: data.quantity,
      p_actor_user_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return result as any;
  });

export const completeOrderDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dispatchId: string }) => {
    if (!input?.dispatchId || !/^[0-9a-f-]{36}$/i.test(input.dispatchId)) throw new Error("Conferência inválida");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("internal_complete_order_dispatch", {
      p_dispatch_id: data.dispatchId,
      p_actor_user_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return result as any;
  });
