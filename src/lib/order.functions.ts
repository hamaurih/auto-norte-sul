import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { z } from "zod";

export type FulfillmentType = "delivery" | "pickup";

export type PickupLocation = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  pickup_instructions: string | null;
  business_hours: string | null;
};

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
  boletoDueDays?: number;
  idempotencyKey: string;
  fulfillmentType?: FulfillmentType;
  pickupBranchId?: string;
};

export type ValidatedCartItem = {
  product_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit_price: number;
  list_price: number;
  stock_available: number;
};

const storefrontOrderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().email().max(255),
    phone: z.string().trim().refine((v) => /^\d{10,11}$/.test(v.replace(/\D/g, "")), "Telefone inválido"),
    document: z.string().trim().min(11).max(20),
    shipping_zip: z.string().trim().refine((v) => /^\d{8}$/.test(v.replace(/\D/g, "")), "CEP inválido"),
    shipping_street: z.string().trim().min(2).max(200),
    shipping_number: z.string().trim().min(1).max(20),
    shipping_complement: z.string().trim().max(120).optional().or(z.literal("")),
    shipping_neighborhood: z.string().trim().min(2).max(120),
    shipping_city: z.string().trim().min(2).max(120),
    shipping_state: z.string().trim().length(2),
  }),
  items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(1000) }))
    .min(1).max(100),
  paymentMethod: z.enum(["pix", "cartao", "boleto", "faturado_b2b"]),
  boletoDueDays: z.union([z.literal(3), z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(90), z.literal(120)]).optional(),
  idempotencyKey: z.string().uuid(),
  fulfillmentType: z.enum(["delivery", "pickup"]).default("delivery"),
  pickupBranchId: z.string().uuid().optional(),
}).superRefine((data, ctx) => {
  if (data.fulfillmentType === "pickup" && !data.pickupBranchId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pickupBranchId"],
      message: "Selecione a loja para retirada.",
    });
  }
});
const orderIdInputSchema = z.object({ orderId: z.string().uuid() });

export const listStorefrontPickupLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: branches, error } = await (supabaseAdmin as any)
      .from("branches")
      .select("id,name,code,address,city,state,phone,pickup_instructions,is_main")
      .eq("tenant_id", context.tenantId)
      .eq("active", true)
      .eq("available_for_pickup", true)
      .order("is_main", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);

    const { data: profile } = await (supabaseAdmin as any)
      .from("tenant_company_profiles")
      .select("business_hours")
      .eq("tenant_id", context.tenantId)
      .maybeSingle();

    return (branches ?? []).map((branch: any) => ({
      id: branch.id,
      name: branch.name,
      code: branch.code,
      address: branch.address,
      city: branch.city,
      state: branch.state,
      phone: branch.phone,
      pickup_instructions: branch.pickup_instructions,
      business_hours: profile?.business_hours ?? null,
    })) as PickupLocation[];
  });

export const createStorefrontOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => storefrontOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const customerDocument = data.customer.document.replace(/\D/g, "");
    const fulfillmentType = data.fulfillmentType ?? "delivery";

    let pickupBranch: { id: string } | null = null;
    if (fulfillmentType === "pickup") {
      const { data: branch, error: branchError } = await (supabaseAdmin as any)
        .from("branches")
        .select("id,address,city,state")
        .eq("id", data.pickupBranchId)
        .eq("tenant_id", context.tenantId)
        .eq("active", true)
        .eq("available_for_pickup", true)
        .maybeSingle();
      if (branchError) throw new Error(branchError.message);
      if (!branch) throw new Error("A loja selecionada não está disponível para retirada.");
      if (!branch.address || !branch.city || !branch.state) {
        throw new Error("A loja selecionada ainda não possui endereço completo para retirada.");
      }
      pickupBranch = branch;
    }

    // A ficha comercial pode já existir por importação do Bling antes de o
    // cliente criar a conta da loja. Vinculamos essa ficha ao login antes do
    // RPC criar o pedido, evitando duplicidade em (tenant_id, document).
    const { data: documentCustomer, error: documentCustomerError } = await (supabaseAdmin as any)
      .from("customers")
      .select("id, user_id")
      .eq("tenant_id", context.tenantId)
      .eq("document", customerDocument)
      .maybeSingle();
    if (documentCustomerError) throw new Error(documentCustomerError.message);
    if (documentCustomer && documentCustomer.user_id !== context.userId) {
      if (documentCustomer.user_id) {
        throw new Error("Este CPF/CNPJ já está vinculado a outra conta. Entre em contato com a Norte Sul para regularizar o cadastro.");
      }
      const { data: accountStub, error: accountStubError } = await (supabaseAdmin as any)
        .from("customers")
        .select("id")
        .eq("tenant_id", context.tenantId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (accountStubError) throw new Error(accountStubError.message);
      if (accountStub && accountStub.id !== documentCustomer.id) {
        const { error: detachError } = await (supabaseAdmin as any)
          .from("customers")
          .update({ user_id: null })
          .eq("id", accountStub.id)
          .eq("tenant_id", context.tenantId);
        if (detachError) throw new Error(detachError.message);
      }
      const { error: linkError } = await (supabaseAdmin as any)
        .from("customers")
        .update({ user_id: context.userId, email: data.customer.email.trim().toLowerCase(), active: true })
        .eq("id", documentCustomer.id)
        .eq("tenant_id", context.tenantId);
      if (linkError) throw new Error(linkError.message);
    }
    const { data: validatedItems, error: validationError } = await (supabaseAdmin as any).rpc(
      "validate_cart_items",
      { p_tenant_id: context.tenantId, p_items: data.items },
    );
    if (validationError) throw new Error(`Validação: ${validationError.message}`);
    if (!Array.isArray(validatedItems) || validatedItems.length === 0) {
      throw new Error("Nenhum item válido no carrinho");
    }
    const { data: orderId, error } = await (supabaseAdmin as any).rpc(
      "internal_create_storefront_order",
      {
        p_user_id: context.userId,
        p_tenant_slug: context.tenantSlug,
        p_customer: data.customer,
        p_items: validatedItems.map((item: ValidatedCartItem) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
        p_payment_method: data.paymentMethod,
        p_idempotency_key: data.idempotencyKey,
      },
    );
    if (error) throw new Error(error.message);
    if (!orderId) throw new Error("Pedido não retornado");

    const { error: fulfillmentError } = await (supabaseAdmin as any)
      .from("orders")
      .update({
        fulfillment_type: fulfillmentType,
        pickup_branch_id: pickupBranch?.id ?? null,
        pickup_status: fulfillmentType === "pickup" ? "awaiting_preparation" : null,
        pickup_ready_at: null,
        picked_up_at: null,
        ...(fulfillmentType === "pickup" ? { shipping: 0 } : {}),
      })
      .eq("id", orderId)
      .eq("tenant_id", context.tenantId);
    if (fulfillmentError) throw new Error(fulfillmentError.message);

    return {
      id: orderId as string,
      boletoDueDays: data.boletoDueDays ?? 15,
      fulfillmentType,
      pickupBranchId: pickupBranch?.id ?? null,
    };
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderIdInputSchema.parse(input))
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
    await (supabaseAdmin as any)
      .from("orders")
      .update({ pickup_status: "cancelled" })
      .eq("id", data.orderId)
      .eq("tenant_id", context.tenantId)
      .eq("fulfillment_type", "pickup");
    return { status };
  });

export const confirmOrderPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderIdInputSchema.parse(input))
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
  | "deliver"
  | "ready_pickup"
  | "complete_pickup";

const operationalStatus = {
  invoice: "faturado",
  ship: "enviado",
  deliver: "entregue",
} as const;

export const getAdminOrderDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderIdInputSchema.parse(input))
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

    const [itemsResult, paymentsResult, historyResult, pickupBranchResult] = await Promise.all([
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
      order.pickup_branch_id
        ? sb
            .from("branches")
            .select("id,name,code,address,city,state,phone,pickup_instructions")
            .eq("id", order.pickup_branch_id)
            .eq("tenant_id", context.tenantId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const error = itemsResult.error ?? paymentsResult.error ?? historyResult.error ?? pickupBranchResult.error;
    if (error) throw new Error(error.message);

    return {
      order,
      items: itemsResult.data ?? [],
      payments: paymentsResult.data ?? [],
      history: historyResult.data ?? [],
      pickupBranch: pickupBranchResult.data ?? null,
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
      if (data.operation === "cancel") {
        await (supabaseAdmin as any)
          .from("orders")
          .update({ pickup_status: "cancelled" })
          .eq("id", data.orderId)
          .eq("tenant_id", context.tenantId)
          .eq("fulfillment_type", "pickup");
      }
      return { status };
    }

    const { data: order, error: orderError } = await (supabaseAdmin as any)
      .from("orders")
      .select("id,status,fulfillment_type,pickup_status")
      .eq("id", data.orderId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido não encontrado.");

    if (data.operation === "ready_pickup") {
      if (order.fulfillment_type !== "pickup") throw new Error("Este pedido não é para retirada em loja.");
      if (order.status !== "faturado") throw new Error("Fature o pedido antes de liberá-lo para retirada.");
      const { error } = await (supabaseAdmin as any)
        .from("orders")
        .update({ pickup_status: "ready", pickup_ready_at: new Date().toISOString() })
        .eq("id", data.orderId)
        .eq("tenant_id", context.tenantId);
      if (error) throw new Error(error.message);
      await (supabaseAdmin as any).from("order_status_events").insert({
        tenant_id: context.tenantId,
        order_id: data.orderId,
        from_status: order.status,
        to_status: order.status,
        note: data.note?.trim() || "Pedido pronto para retirada na loja.",
        actor_user_id: context.userId,
      });
      return { status: order.status, pickupStatus: "ready" };
    }

    if (data.operation === "complete_pickup") {
      if (order.fulfillment_type !== "pickup") throw new Error("Este pedido não é para retirada em loja.");
      if (order.status !== "faturado" || order.pickup_status !== "ready") {
        throw new Error("O pedido precisa estar faturado e pronto para retirada.");
      }
      const { data: status, error } = await (supabaseAdmin as any).rpc(
        "internal_operate_order",
        {
          p_order_id: data.orderId,
          p_next_status: "entregue",
          p_note: data.note?.trim() || "Pedido retirado pelo cliente na loja.",
          p_actor_user_id: context.userId,
        },
      );
      if (error) throw new Error(error.message);
      const { error: pickupError } = await (supabaseAdmin as any)
        .from("orders")
        .update({ pickup_status: "picked_up", picked_up_at: new Date().toISOString() })
        .eq("id", data.orderId)
        .eq("tenant_id", context.tenantId);
      if (pickupError) throw new Error(pickupError.message);
      return { status, pickupStatus: "picked_up" };
    }

    if (data.operation === "ship" && order.fulfillment_type === "pickup") {
      throw new Error("Pedido para retirada não deve ser marcado como enviado.");
    }
    if (data.operation === "deliver" && order.fulfillment_type === "pickup") {
      throw new Error("Use a ação de confirmar retirada para este pedido.");
    }

    const nextStatus = operationalStatus[data.operation as keyof typeof operationalStatus];
    if (!nextStatus) throw new Error("Operação inválida.");
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