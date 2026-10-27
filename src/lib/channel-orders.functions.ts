import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const staffRoles = ["owner", "admin", "manager", "sales"] as const;

const whatsappOrderSchema = z.object({
  warehouseId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(1000),
  })).min(1).max(100),
  customerId: z.string().uuid().optional(),
  customer: z.object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(255).optional().or(z.literal("")),
    phone: z.string().trim().min(8).max(30).optional().or(z.literal("")),
    document: z.string().trim().max(30).optional().or(z.literal("")),
    shipping_zip: z.string().trim().max(16).optional().or(z.literal("")),
    shipping_street: z.string().trim().max(200).optional().or(z.literal("")),
    shipping_number: z.string().trim().max(30).optional().or(z.literal("")),
    shipping_complement: z.string().trim().max(120).optional().or(z.literal("")),
    shipping_neighborhood: z.string().trim().max(120).optional().or(z.literal("")),
    shipping_city: z.string().trim().max(120).optional().or(z.literal("")),
    shipping_state: z.string().trim().max(2).optional().or(z.literal("")),
  }),
  paymentMethod: z.enum(["pix", "cartao", "boleto", "cash", "faturado_b2b"]).default("pix"),
  sourceReference: z.string().trim().max(160).optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).optional(),
  fulfillmentType: z.enum(["delivery", "pickup"]).default("delivery"),
  pickupBranchId: z.string().uuid().optional(),
});

export const createWhatsAppOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => whatsappOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireTenantRole(
      supabaseAdmin as any,
      context.userId,
      context.tenantId,
      [...staffRoles],
    );

    const { data: orderId, error } = await (supabaseAdmin as any).rpc("create_whatsapp_order", {
      p_tenant_id: context.tenantId,
      p_idempotency_key: data.idempotencyKey,
      p_warehouse_id: data.warehouseId,
      p_items: data.items,
      p_customer_id: data.customerId ?? null,
      p_customer: data.customer,
      p_payment_method: data.paymentMethod,
      p_source_reference: data.sourceReference ?? null,
      p_source_metadata: data.sourceMetadata ?? {},
      p_fulfillment_type: data.fulfillmentType,
      p_pickup_branch_id: data.pickupBranchId ?? null,
    });
    if (error) throw new Error(error.message);
    return { orderId: String(orderId) };
  });

export const confirmWhatsAppOrderPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    orderId: z.string().uuid(),
    paymentReference: z.string().trim().max(160).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await requireTenantRole(
      supabaseAdmin as any,
      context.userId,
      context.tenantId,
      [...staffRoles],
    );

    const { data: order, error: orderError } = await (supabaseAdmin as any)
      .from("orders")
      .select("id,tenant_id")
      .eq("id", data.orderId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido não encontrado.");

    const { data: status, error } = await (supabaseAdmin as any).rpc(
      "confirm_whatsapp_order_payment",
      {
        p_order_id: data.orderId,
        p_payment_reference: data.paymentReference ?? null,
      },
    );
    if (error) throw new Error(error.message);

    try {
      const { processBlingPaidSaleNow } = await import("@/lib/bling-sales-export.server");
      await processBlingPaidSaleNow(context.tenantId, data.orderId);
    } catch (blingError) {
      console.error("[WhatsApp Bling immediate sync]", blingError);
    }

    return { status: String(status) };
  });

export const cancelWhatsAppOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    orderId: z.string().uuid(),
    reason: z.string().trim().min(5).max(500),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await requireTenantRole(
      supabaseAdmin as any,
      context.userId,
      context.tenantId,
      [...staffRoles],
    );

    const { data: order, error: orderError } = await (supabaseAdmin as any)
      .from("orders")
      .select("id,tenant_id")
      .eq("id", data.orderId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido não encontrado.");

    const { data: status, error } = await (supabaseAdmin as any).rpc(
      "cancel_whatsapp_order",
      { p_order_id: data.orderId, p_reason: data.reason },
    );
    if (error) throw new Error(error.message);
    return { status: String(status) };
  });
