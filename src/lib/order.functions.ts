import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";

export type StorefrontOrderInput = {
  customer: {
    name: string;
    email: string;
    phone: string;
    document: string;
    shipping_zip: string;
    shipping_street: string;
    shipping_number: string;
    shipping_complement?: string;
    shipping_neighborhood: string;
    shipping_city: string;
    shipping_state: string;
  };
  items: Array<{ product_id: string; quantity: number }>;
  paymentMethod: "pix" | "cartao" | "boleto" | "faturado_b2b";
  idempotencyKey: string;
};

export const createStorefrontOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StorefrontOrderInput) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: orderId, error } = await (supabaseAdmin as any).rpc(
      "internal_create_storefront_order",
      {
        p_user_id: context.userId,
        p_tenant_slug: context.tenantSlug,
        p_customer: data.customer,
        p_items: data.items,
        p_payment_method: data.paymentMethod,
        p_idempotency_key: data.idempotencyKey,
      },
    );
    if (error) throw new Error(error.message);
    if (!orderId) throw new Error("Pedido não retornado");
    return { id: orderId as string };
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: status, error } = await (supabaseAdmin as any).rpc(
      "internal_transition_order",
      {
        p_order_id: data.orderId,
        p_action: "cancel",
        p_actor_user_id: context.userId,
      },
    );
    if (error) throw new Error(error.message);
    return { status };
  });

export const confirmOrderPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: status, error } = await (supabaseAdmin as any).rpc(
      "internal_transition_order",
      {
        p_order_id: data.orderId,
        p_action: "confirm_payment",
        p_actor_user_id: context.userId,
      },
    );
    if (error) throw new Error(error.message);
    return { status };
  });


export type OrderOperation =
  | "confirm_payment"
  | "cancel"
  | "invoice"
  | "ship"
  | "deliver";

const operationalStatus = {
  invoice: "faturado",
  ship: "enviado",
  deliver: "entregue",
} as const;

export const getAdminOrderDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: order, error: orderError } = await sb
      .from("orders")
      .select("*")
      .eq("id", data.orderId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();

    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido não encontrado ou sem permissão de acesso.");

    const [itemsResult, paymentsResult, historyResult] = await Promise.all([
      sb
        .from("order_items")
        .select("id, product_id, sku, name, quantity, unit_price, total, product:products(id, slug, images:product_images(url, alt, is_primary, sort_order))")
        .eq("order_id", data.orderId)
        .eq("tenant_id", context.tenantId)
        .order("name"),
      sb
        .from("payment_intents")
        .select("id, method, amount, currency, status, external_id, checkout_url, boleto_url, expires_at, authorized_at, paid_at, cancelled_at, failure_code, failure_message, created_at, updated_at, provider:payment_providers(code, display_name)")
        .eq("order_id", data.orderId)
        .eq("tenant_id", context.tenantId)
        .order("created_at", { ascending: false }),
      sb
        .from("order_status_events")
        .select("id, from_status, to_status, note, actor_user_id, created_at")
        .eq("order_id", data.orderId)
        .eq("tenant_id", context.tenantId)
        .order("created_at", { ascending: true }),
    ]);

    const error = itemsResult.error ?? paymentsResult.error ?? historyResult.error;
    if (error) throw new Error(error.message);

    return {
      order,
      items: itemsResult.data ?? [],
      payments: paymentsResult.data ?? [],
      history: historyResult.data ?? [],
    };
  });

export const updateAdminOrderOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; operation: OrderOperation; note?: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.operation === "confirm_payment" || data.operation === "cancel") {
      const { data: status, error } = await (supabaseAdmin as any).rpc(
        "internal_transition_order",
        {
          p_order_id: data.orderId,
          p_action: data.operation,
          p_actor_user_id: context.userId,
        },
      );
      if (error) throw new Error(error.message);
      return { status };
    }

    const nextStatus = operationalStatus[data.operation];
    const { data: status, error } = await (supabaseAdmin as any).rpc(
      "internal_operate_order",
      {
        p_order_id: data.orderId,
        p_next_status: nextStatus,
        p_note: data.note?.trim() || null,
        p_actor_user_id: context.userId,
      },
    );

    if (error) throw new Error(error.message);
    return { status };
  });
