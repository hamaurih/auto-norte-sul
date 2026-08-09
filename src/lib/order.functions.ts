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
