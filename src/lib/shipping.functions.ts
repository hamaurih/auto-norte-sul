import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";

export type ShipmentStatus =
  | "aguardando_separacao"
  | "em_separacao"
  | "aguardando_conferencia"
  | "pronto_envio"
  | "postado"
  | "em_transito"
  | "entregue"
  | "ocorrencia"
  | "devolvido"
  | "cancelado";

export type ShipmentInput = {
  orderId: string;
  status: ShipmentStatus;
  carrierName?: string;
  serviceName?: string;
  trackingCode?: string;
  trackingUrl?: string;
  estimatedDeliveryAt?: string;
  notes?: string;
  package?: {
    weightKg: number;
    heightCm: number;
    widthCm: number;
    lengthCm: number;
  };
};

const clean = (value?: string) => value?.trim() || null;

export const listShippingQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data: orders, error: ordersError } = await sb
      .from("orders")
      .select("id, status, customer_name, customer_email, shipping_city, shipping_state, total, created_at")
      .eq("tenant_id", context.tenantId)
      .in("status", ["pago", "faturado", "enviado", "entregue"])
      .order("created_at", { ascending: true });

    if (ordersError) throw new Error(ordersError.message);

    const orderIds = (orders ?? []).map((order: any) => order.id);
    if (orderIds.length === 0) return [];

    const { data: shipments, error: shipmentsError } = await sb
      .from("shipments")
      .select("*, packages:shipment_packages(*), events:shipment_events(id, event_type, description, created_at)")
      .eq("tenant_id", context.tenantId)
      .in("order_id", orderIds)
      .order("updated_at", { ascending: false });

    if (shipmentsError) throw new Error(shipmentsError.message);
    const byOrder = new Map((shipments ?? []).map((shipment: any) => [shipment.order_id, shipment]));

    return (orders ?? []).map((order: any) => ({
      order,
      shipment: byOrder.get(order.id) ?? null,
    }));
  });

export const saveShipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ShipmentInput) => input)
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: order, error: orderError } = await sb
      .from("orders")
      .select("id")
      .eq("id", data.orderId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();

    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido não encontrado.");

    const payload = {
      tenant_id: context.tenantId,
      order_id: data.orderId,
      status: data.status,
      carrier_name: clean(data.carrierName),
      service_name: clean(data.serviceName),
      tracking_code: clean(data.trackingCode),
      tracking_url: clean(data.trackingUrl),
      estimated_delivery_at: clean(data.estimatedDeliveryAt),
      notes: clean(data.notes),
      picker_user_id: data.status === "em_separacao" ? context.userId : undefined,
      picked_at: data.status === "aguardando_conferencia" ? new Date().toISOString() : undefined,
      checker_user_id: data.status === "pronto_envio" ? context.userId : undefined,
      checked_at: data.status === "pronto_envio" ? new Date().toISOString() : undefined,
      posted_at: data.status === "postado" ? new Date().toISOString() : undefined,
      delivered_at: data.status === "entregue" ? new Date().toISOString() : undefined,
      created_by: context.userId,
    };

    const { data: previous } = await sb
      .from("shipments")
      .select("id, status")
      .eq("tenant_id", context.tenantId)
      .eq("order_id", data.orderId)
      .maybeSingle();

    const { data: shipment, error } = await sb
      .from("shipments")
      .upsert(payload, { onConflict: "order_id,tenant_id" })
      .select("id, status")
      .single();

    if (error) throw new Error(error.message);

    if (data.package) {
      const pkg = data.package;
      if ([pkg.weightKg, pkg.heightCm, pkg.widthCm, pkg.lengthCm].some((value) => !Number.isFinite(value) || value <= 0)) {
        throw new Error("Peso e dimensões devem ser maiores que zero.");
      }
      const { error: packageError } = await sb.from("shipment_packages").upsert(
        {
          tenant_id: context.tenantId,
          shipment_id: shipment.id,
          sequence: 1,
          weight_kg: pkg.weightKg,
          height_cm: pkg.heightCm,
          width_cm: pkg.widthCm,
          length_cm: pkg.lengthCm,
        },
        { onConflict: "shipment_id,sequence" },
      );
      if (packageError) throw new Error(packageError.message);
    }

    const eventType = !previous
      ? "criado"
      : previous.status !== data.status
        ? "status"
        : data.trackingCode
          ? "rastreamento"
          : "observacao";
    const description = !previous
      ? "Expedição criada"
      : previous.status !== data.status
        ? `Status atualizado de ${previous.status} para ${data.status}`
        : "Dados da expedição atualizados";

    const { error: eventError } = await sb.from("shipment_events").insert({
      tenant_id: context.tenantId,
      shipment_id: shipment.id,
      event_type: eventType,
      from_status: previous?.status ?? null,
      to_status: data.status,
      description,
      actor_user_id: context.userId,
    });
    if (eventError) throw new Error(eventError.message);

    return { id: shipment.id, status: shipment.status };
  });

export const addShipmentOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    shipmentId: string;
    type: "ocorrencia" | "atraso" | "avaria" | "extravio" | "devolucao" | "observacao";
    description: string;
  }) => input)
  .handler(async ({ data, context }) => {
    const description = data.description.trim();
    if (!description || description.length > 1000) throw new Error("Informe uma descrição com até 1.000 caracteres.");

    const sb = context.supabase as any;
    const { data: shipment, error } = await sb
      .from("shipments")
      .select("id, status")
      .eq("id", data.shipmentId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!shipment) throw new Error("Expedição não encontrada.");

    const nextStatus = data.type === "devolucao" ? "devolvido" : data.type === "observacao" ? shipment.status : "ocorrencia";
    if (nextStatus !== shipment.status) {
      const { error: updateError } = await sb
        .from("shipments")
        .update({ status: nextStatus })
        .eq("id", shipment.id)
        .eq("tenant_id", context.tenantId);
      if (updateError) throw new Error(updateError.message);
    }

    const { error: eventError } = await sb.from("shipment_events").insert({
      tenant_id: context.tenantId,
      shipment_id: shipment.id,
      event_type: data.type,
      from_status: shipment.status,
      to_status: nextStatus,
      description,
      actor_user_id: context.userId,
    });
    if (eventError) throw new Error(eventError.message);
    return { status: nextStatus };
  });