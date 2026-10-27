import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";

export type OperationsStage =
  | "novo"
  | "pagamento"
  | "separacao"
  | "conferencia"
  | "pronto"
  | "entrega_retirada"
  | "concluido"
  | "cancelado";

export type OperationsIssue = {
  code: string;
  label: string;
  severity: "warning" | "critical";
};

export type OperationsOrder = {
  id: string;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  customerEmail: string | null;
  total: number;
  status: string;
  financialStatus: "paid" | "pending" | "cancelled" | "failed";
  channelCode: string;
  channelName: string;
  isB2B: boolean;
  fulfillmentType: string;
  pickupStatus: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  stage: OperationsStage;
  stageSince: string;
  ageMinutes: number;
  dispatchId: string | null;
  dispatchStatus: string | null;
  shipmentStatus: string | null;
  blingSyncStatus: string;
  blingSyncError: string | null;
  blingNumber: string | null;
  invoiceStatus: string | null;
  issues: OperationsIssue[];
  nextAction:
    | "start_dispatch"
    | "open_dispatch"
    | "invoice"
    | "ship"
    | "deliver"
    | "ready_pickup"
    | "complete_pickup"
    | null;
};

const inputSchema = z.object({
  query: z.string().trim().max(120).optional().default(""),
  channel: z.string().trim().max(40).optional().default(""),
  stage: z.string().trim().max(40).optional().default(""),
  fulfillment: z.enum(["", "delivery", "pickup"]).optional().default(""),
  exceptionsOnly: z.boolean().optional().default(false),
  page: z.number().int().min(0).max(1000).optional().default(0),
  pageSize: z.number().int().min(10).max(100).optional().default(50),
});

const ACTIVE_ROLES = ["owner", "admin", "manager", "sales", "stock", "cashier"] as const;

function financialStatus(orderStatus: string, paymentStatuses: string[]) {
  if (paymentStatuses.some((s) => ["paid", "received", "confirmed"].includes(s))) return "paid" as const;
  if (paymentStatuses.some((s) => ["failed"].includes(s))) return "failed" as const;
  if (paymentStatuses.some((s) => ["cancelled", "canceled", "expired", "refunded"].includes(s))) return "cancelled" as const;
  if (["pago", "faturado", "enviado", "entregue"].includes(orderStatus)) return "paid" as const;
  if (orderStatus === "cancelado") return "cancelled" as const;
  return "pending" as const;
}

function minutesSince(value: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

function deriveStage(input: {
  status: string;
  channelCode: string;
  fulfillmentType: string;
  pickupStatus: string | null;
  paymentCount: number;
  dispatchStatus: string | null;
  shipmentStatus: string | null;
}): OperationsStage {
  const { status, channelCode, fulfillmentType, pickupStatus, paymentCount, dispatchStatus, shipmentStatus } = input;
  if (status === "cancelado") return "cancelado";
  if (status === "entregue") return "concluido";
  if (channelCode === "pdv" && status === "pago" && pickupStatus === "picked_up") return "concluido";

  if (status === "aguardando_pagamento") {
    return paymentCount > 0 ? "pagamento" : "novo";
  }

  if (status === "pago") {
    if (dispatchStatus === "conferred") return "pronto";
    if (dispatchStatus === "in_progress" || shipmentStatus === "aguardando_conferencia") return "conferencia";
    return "separacao";
  }

  if (status === "faturado") {
    if (fulfillmentType === "pickup" && pickupStatus === "ready") return "entrega_retirada";
    return "pronto";
  }

  if (status === "enviado") return "entrega_retirada";
  return "novo";
}

function deriveNextAction(order: {
  status: string;
  channelCode: string;
  fulfillmentType: string;
  pickupStatus: string | null;
  dispatchStatus: string | null;
  stage: OperationsStage;
}) {
  if (order.channelCode === "pdv" || order.stage === "concluido" || order.stage === "cancelado") return null;
  if (order.status === "pago" && !order.dispatchStatus) return "start_dispatch" as const;
  if (order.status === "pago" && order.dispatchStatus === "in_progress") return "open_dispatch" as const;
  if (order.status === "pago" && order.dispatchStatus === "conferred") return "invoice" as const;
  if (order.status === "faturado" && order.fulfillmentType === "pickup" && order.pickupStatus !== "ready") return "ready_pickup" as const;
  if (order.status === "faturado" && order.fulfillmentType === "pickup" && order.pickupStatus === "ready") return "complete_pickup" as const;
  if (order.status === "faturado" && order.fulfillmentType === "delivery") return "ship" as const;
  if (order.status === "enviado" && order.fulfillmentType === "delivery") return "deliver" as const;
  return null;
}

function stageSince(
  stage: OperationsStage,
  order: any,
  payment: any | null,
  dispatch: any | null,
  shipment: any | null,
  statusEvent: any | null,
) {
  if (stage === "pagamento" || stage === "novo") return payment?.created_at ?? order.created_at;
  if (stage === "separacao") return payment?.paid_at ?? statusEvent?.created_at ?? order.updated_at ?? order.created_at;
  if (stage === "conferencia") return dispatch?.started_at ?? dispatch?.updated_at ?? order.updated_at ?? order.created_at;
  if (stage === "pronto") return dispatch?.completed_at ?? statusEvent?.created_at ?? shipment?.updated_at ?? order.updated_at ?? order.created_at;
  if (stage === "entrega_retirada") return order.pickup_ready_at ?? statusEvent?.created_at ?? shipment?.updated_at ?? order.updated_at ?? order.created_at;
  return statusEvent?.created_at ?? order.updated_at ?? order.created_at;
}

function deriveIssues(order: OperationsOrder): OperationsIssue[] {
  const issues: OperationsIssue[] = [];
  if (order.financialStatus === "failed" && order.status !== "cancelado") {
    issues.push({ code: "payment_failed", label: "Pagamento com falha", severity: "critical" });
  }
  if (order.blingSyncError) {
    issues.push({ code: "bling_error", label: "Erro de sincronização Bling", severity: "critical" });
  } else if (
    ["pago", "faturado", "enviado", "entregue"].includes(order.status) &&
    !order.blingNumber &&
    !["synced", "cancelled"].includes(order.blingSyncStatus) &&
    order.ageMinutes > 10
  ) {
    issues.push({ code: "bling_pending", label: "Bling pendente há mais de 10 min", severity: "warning" });
  }
  if (order.shipmentStatus === "ocorrencia" || order.shipmentStatus === "devolvido") {
    issues.push({ code: "shipment_issue", label: "Ocorrência na entrega", severity: "critical" });
  }

  const slaByStage: Partial<Record<OperationsStage, { minutes: number; label: string }>> = {
    pagamento: { minutes: 60, label: "Pagamento pendente há mais de 1h" },
    separacao: { minutes: 30, label: "Separação aguardando há mais de 30 min" },
    conferencia: { minutes: 30, label: "Conferência em andamento há mais de 30 min" },
    pronto: { minutes: 60, label: "Pedido pronto sem avanço há mais de 1h" },
    entrega_retirada: {
      minutes: order.fulfillmentType === "pickup" ? 1440 : 2880,
      label: order.fulfillmentType === "pickup" ? "Retirada aguardando há mais de 24h" : "Entrega em andamento há mais de 48h",
    },
  };
  const sla = slaByStage[order.stage];
  if (sla && order.ageMinutes > sla.minutes) {
    issues.push({ code: "sla_overdue", label: sla.label, severity: "warning" });
  }
  return issues;
}

export const getOmnichannelOperationsCenter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const authDb = context.supabase as any;
    await requireTenantRole(authDb, context.userId, context.tenantId, [...ACTIVE_ROLES]);
    const db = supabaseAdmin as any;

    const { data: rawOrders, error: ordersError } = await db
      .from("orders")
      .select("id,customer_name,customer_email,status,total,created_at,updated_at,is_b2b,fulfillment_type,pickup_status,pickup_ready_at,payment_method,bling_sync_status,bling_sync_error,bling_number,bling_invoice_status,sales_channel_id")
      .eq("tenant_id", context.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(750);
    if (ordersError) throw new Error(ordersError.message);

    const orders = rawOrders ?? [];
    const orderIds = orders.map((o: any) => o.id);
    const channelIds = [...new Set(orders.map((o: any) => o.sales_channel_id).filter(Boolean))];

    const [channelsResult, paymentsResult, dispatchResult, shipmentsResult, eventsResult] = await Promise.all([
      channelIds.length
        ? db.from("sales_channels").select("id,code,name").eq("tenant_id", context.tenantId).in("id", channelIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? db.from("payment_intents").select("order_id,status,method,created_at,paid_at,updated_at").eq("tenant_id", context.tenantId).in("order_id", orderIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? db.from("order_dispatches").select("id,order_id,status,started_at,completed_at,updated_at").eq("tenant_id", context.tenantId).in("order_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? db.from("shipments").select("order_id,status,updated_at").eq("tenant_id", context.tenantId).in("order_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? db.from("order_status_events").select("order_id,to_status,created_at").eq("tenant_id", context.tenantId).in("order_id", orderIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    const relatedError = channelsResult.error ?? paymentsResult.error ?? dispatchResult.error ?? shipmentsResult.error ?? eventsResult.error;
    if (relatedError) throw new Error(relatedError.message);

    const channels = new Map<string, { id: string; code: string; name: string }>(
      (channelsResult.data ?? []).map((c: any) => [String(c.id), { id: String(c.id), code: String(c.code), name: String(c.name) }]),
    );
    const paymentsByOrder = new Map<string, any[]>();
    for (const p of paymentsResult.data ?? []) {
      const list = paymentsByOrder.get(p.order_id) ?? [];
      list.push(p);
      paymentsByOrder.set(p.order_id, list);
    }
    const dispatchByOrder = new Map<string, any>(
      (dispatchResult.data ?? []).map((d: any) => [String(d.order_id), d]),
    );
    const shipmentByOrder = new Map<string, any>(
      (shipmentsResult.data ?? []).map((s: any) => [String(s.order_id), s]),
    );
    const latestEventByOrder = new Map<string, any>();
    for (const e of eventsResult.data ?? []) {
      if (!latestEventByOrder.has(e.order_id)) latestEventByOrder.set(e.order_id, e);
    }

    let rows: OperationsOrder[] = orders.map((order: any) => {
      const channel = channels.get(order.sales_channel_id) ?? { code: "default", name: "Padrão" };
      const payments = paymentsByOrder.get(order.id) ?? [];
      const dispatch = dispatchByOrder.get(order.id) ?? null;
      const shipment = shipmentByOrder.get(order.id) ?? null;
      const statusEvent = latestEventByOrder.get(order.id) ?? null;
      const finance = financialStatus(String(order.status), payments.map((p: any) => String(p.status ?? "").toLowerCase()));
      const stage = deriveStage({
        status: String(order.status),
        channelCode: String(channel.code),
        fulfillmentType: String(order.fulfillment_type ?? "delivery"),
        pickupStatus: order.pickup_status ?? null,
        paymentCount: payments.length,
        dispatchStatus: dispatch?.status ?? null,
        shipmentStatus: shipment?.status ?? null,
      });
      const since = stageSince(stage, order, payments[0] ?? null, dispatch, shipment, statusEvent);
      const base: OperationsOrder = {
        id: order.id,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        customerName: order.customer_name || "Cliente não identificado",
        customerEmail: order.customer_email ?? null,
        total: Number(order.total ?? 0),
        status: String(order.status),
        financialStatus: finance,
        channelCode: String(channel.code),
        channelName: String(channel.name),
        isB2B: Boolean(order.is_b2b),
        fulfillmentType: String(order.fulfillment_type ?? "delivery"),
        pickupStatus: order.pickup_status ?? null,
        paymentMethod: order.payment_method ?? payments[0]?.method ?? null,
        paymentStatus: payments[0]?.status ?? null,
        stage,
        stageSince: since,
        ageMinutes: minutesSince(since),
        dispatchId: dispatch?.id ?? null,
        dispatchStatus: dispatch?.status ?? null,
        shipmentStatus: shipment?.status ?? null,
        blingSyncStatus: String(order.bling_sync_status ?? "not_synced"),
        blingSyncError: order.bling_sync_error ?? null,
        blingNumber: order.bling_number ?? null,
        invoiceStatus: order.bling_invoice_status ?? null,
        issues: [],
        nextAction: null,
      };
      base.issues = deriveIssues(base);
      base.nextAction = deriveNextAction(base);
      return base;
    });

    const q = data.query.toLocaleLowerCase("pt-BR");
    if (q) {
      rows = rows.filter((o) =>
        o.id.toLocaleLowerCase("pt-BR").includes(q) ||
        o.customerName.toLocaleLowerCase("pt-BR").includes(q) ||
        (o.customerEmail ?? "").toLocaleLowerCase("pt-BR").includes(q) ||
        (o.blingNumber ?? "").toLocaleLowerCase("pt-BR").includes(q)
      );
    }
    if (data.channel) rows = rows.filter((o) => o.channelCode === data.channel);
    if (data.stage) rows = rows.filter((o) => o.stage === data.stage);
    if (data.fulfillment) rows = rows.filter((o) => o.fulfillmentType === data.fulfillment);
    if (data.exceptionsOnly) rows = rows.filter((o) => o.issues.length > 0);

    const activeRows = rows.filter((o) => !["concluido", "cancelado"].includes(o.stage));
    const stageCounts = Object.fromEntries(
      (["novo", "pagamento", "separacao", "conferencia", "pronto", "entrega_retirada", "concluido", "cancelado"] as OperationsStage[])
        .map((stage) => [stage, rows.filter((o) => o.stage === stage).length]),
    );
    const channelSummary = ["site", "pdv", "whatsapp", "vendedor"].map((code) => {
      const items = rows.filter((o) => o.channelCode === code && o.stage !== "cancelado");
      return { code, orders: items.length, gross: items.reduce((sum, o) => sum + o.total, 0) };
    });

    rows.sort((a, b) => {
      const severity = (o: OperationsOrder) => o.issues.some((i) => i.severity === "critical") ? 2 : o.issues.length ? 1 : 0;
      return severity(b) - severity(a) || b.ageMinutes - a.ageMinutes || +new Date(b.createdAt) - +new Date(a.createdAt);
    });

    const start = data.page * data.pageSize;
    const paged = rows.slice(start, start + data.pageSize);

    return {
      rows: paged,
      totalFiltered: rows.length,
      page: data.page,
      pageSize: data.pageSize,
      summary: {
        active: activeRows.length,
        actionRequired: rows.filter((o) => o.nextAction !== null).length,
        exceptions: rows.filter((o) => o.issues.length > 0).length,
        ready: rows.filter((o) => o.stage === "pronto").length,
        stageCounts,
        channelSummary,
      },
    };
  });

export const retryAdminOrderBling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireTenantRole(context.supabase as any, context.userId, context.tenantId, ["owner", "admin", "manager", "sales"]);
    const db = supabaseAdmin as any;

    const { data: order, error: orderError } = await db.from("orders")
      .select("id,status,bling_id,bling_sync_status")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.orderId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido não encontrado.");
    if (order.status === "cancelado") throw new Error("Pedido cancelado não deve ser enviado ao Bling.");
    if (!["pago", "faturado", "enviado", "entregue"].includes(String(order.status))) {
      throw new Error("O pedido ainda não está pago/faturado para sincronização.");
    }
    if (order.bling_id && order.bling_sync_status === "synced") {
      return { ok: true, alreadySynced: true };
    }

    const { data: job, error: jobError } = await db.from("bling_order_sync_jobs")
      .select("id,status,attempts")
      .eq("tenant_id", context.tenantId)
      .eq("order_id", data.orderId)
      .eq("event_type", "paid")
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);

    if (job?.id && job.status !== "done") {
      const { error } = await db.from("bling_order_sync_jobs")
        .update({ status: "queued", scheduled_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
        .eq("tenant_id", context.tenantId)
        .eq("id", job.id);
      if (error) throw new Error(error.message);
    }

    const { processBlingPaidSaleNow } = await import("@/lib/bling-sales-export.server");
    const result = await processBlingPaidSaleNow(context.tenantId, data.orderId);
    return { ok: result.failed === 0, alreadySynced: false, result };
  });
