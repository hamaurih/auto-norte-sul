import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getBlingAccessToken } from "@/lib/bling-sales-export.server";

const API = "https://api.bling.com.br/Api/v3";
const READ_ROLES = ["owner","admin","manager","sales","stock"] as const;
const SYNC_ROLES = ["owner","admin","manager","sales"] as const;

function pick(obj: any, paths: string[]) {
  for (const path of paths) {
    let cur = obj;
    for (const key of path.split(".")) cur = cur?.[key];
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return null;
}

function toPositiveInt(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isoOrNull(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function rawStatus(note: any) {
  const value = pick(note, ["situacao.valor","situacao.descricao","situacao.nome","situacao","status"]);
  return value == null ? null : String(typeof value === "object" ? JSON.stringify(value) : value);
}

function normalizedStatus(note: any) {
  const text = String(rawStatus(note) ?? "").toLocaleLowerCase("pt-BR");
  const accessKey = String(pick(note, ["chaveAcesso","chave","accessKey"]) ?? "");
  const protocol = String(pick(note, ["protocolo","numeroProtocolo","protocol"]) ?? "");
  if (text.includes("cancel")) return "cancelled";
  if (text.includes("deneg")) return "denied";
  if (text.includes("rejeit") || text.includes("erro")) return "rejected";
  if (accessKey.length >= 40 || protocol.length >= 8 || text.includes("autoriz")) return "authorized";
  if (text.includes("conting")) return "contingency";
  if (text.includes("process") || text.includes("envi")) return "processing";
  return "queued";
}

function extractInvoiceId(orderPayload: any) {
  return pick(orderPayload, [
    "notaFiscal.id",
    "notaFiscal.idNotaFiscal",
    "nfe.id",
    "nota.id",
    "documentoFiscal.id",
  ]);
}

async function blingGet(path: string, token: string) {
  const res = await fetch(API + path, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json", "enable-jwt": "1" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = String(body?.error?.message ?? body?.message ?? "").slice(0,160);
    throw new Error("Bling HTTP " + res.status + " em " + path + (detail ? ": " + detail : ""));
  }
  return body?.data ?? body;
}

async function fiscalContext(tenantId: string, orderId: string) {
  const db = supabaseAdmin as any;
  const [{ data: order, error: orderError }, { data: settings, error: settingsError }] = await Promise.all([
    db.from("orders")
      .select("id,tenant_id,status,total,customer_name,customer_document,customer_email,customer_phone,bling_id,bling_invoice_id,bling_invoice_status")
      .eq("tenant_id",tenantId).eq("id",orderId).maybeSingle(),
    db.from("fiscal_settings")
      .select("id,branch_id,environment")
      .eq("tenant_id",tenantId)
      .order("created_at",{ascending:true})
      .limit(1)
      .maybeSingle(),
  ]);
  if (orderError) throw new Error(orderError.message);
  if (!order) throw new Error("Pedido não encontrado.");
  if (settingsError) throw new Error(settingsError.message);
  return { order, settings };
}

async function syncOrderFiscalInternal(input: {
  tenantId: string;
  userId: string | null;
  orderId: string;
  token?: string;
}) {
  const db = supabaseAdmin as any;
  const { order, settings } = await fiscalContext(input.tenantId, input.orderId);

  if (!order.bling_id) {
    await db.from("orders").update({
      bling_invoice_status: "aguardando_sincronizacao_pedido",
      updated_at: new Date().toISOString(),
    }).eq("tenant_id",input.tenantId).eq("id",order.id);
    return { ok:true, state:"waiting_order_sync", document:null };
  }

  const token = input.token ?? await getBlingAccessToken(input.tenantId);
  const remoteOrder = await blingGet("/pedidos/vendas/" + encodeURIComponent(String(order.bling_id)), token);
  const invoiceId = String(extractInvoiceId(remoteOrder) ?? order.bling_invoice_id ?? "").trim();

  if (!invoiceId) {
    await db.from("orders").update({
      bling_invoice_status: "aguardando_emissao",
      updated_at: new Date().toISOString(),
    }).eq("tenant_id",input.tenantId).eq("id",order.id);
    return { ok:true, state:"waiting_invoice", document:null };
  }

  const note = await blingGet("/nfe/" + encodeURIComponent(invoiceId), token);
  const number = toPositiveInt(pick(note,["numero","numeroNota","number"]));
  const series = toPositiveInt(pick(note,["serie","series"])) ?? 1;
  const accessKey = String(pick(note,["chaveAcesso","chave","accessKey"]) ?? "").trim() || null;
  const protocol = String(pick(note,["protocolo","numeroProtocolo","protocol"]) ?? "").trim() || null;
  const status = normalizedStatus(note);
  const externalStatus = rawStatus(note);
  const issuedAt = isoOrNull(pick(note,["dataEmissao","emissao","issuedAt"]));
  const authorizedAt = isoOrNull(pick(note,["dataOperacao","dataAutorizacao","authorizedAt"]));
  const linkDanfe = String(pick(note,["linkDanfe","linkPDF","urlDanfe"]) ?? "").trim() || null;
  const linkXml = String(pick(note,["linkXml","urlXml"]) ?? "").trim() || null;

  const orderUpdate:any = {
    bling_invoice_id: invoiceId,
    bling_invoice_status: externalStatus ?? status,
    bling_invoice_generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (status === "authorized") orderUpdate.bling_invoice_authorized_at = authorizedAt ?? new Date().toISOString();

  if (!number || !settings?.branch_id) {
    await db.from("orders").update(orderUpdate)
      .eq("tenant_id",input.tenantId).eq("id",order.id);
    return {
      ok:true,
      state: !number ? "invoice_found_pending_number" : "invoice_found_fiscal_settings_missing",
      invoiceId,
      status,
      document:null,
    };
  }

  const { data: existingByProvider, error: existingError } = await db.from("fiscal_documents")
    .select("id,status,provider,provider_reference")
    .eq("tenant_id",input.tenantId)
    .eq("provider","bling")
    .eq("provider_reference",invoiceId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let existing = existingByProvider;
  if (!existing) {
    const { data: activeOrderDoc, error: activeError } = await db.from("fiscal_documents")
      .select("id,status,provider,provider_reference")
      .eq("tenant_id",input.tenantId)
      .eq("order_id",order.id)
      .eq("model","55")
      .neq("status","cancelled")
      .maybeSingle();
    if (activeError) throw new Error(activeError.message);
    if (activeOrderDoc && ["authorized","processing","contingency"].includes(String(activeOrderDoc.status)) && activeOrderDoc.provider !== "bling") {
      throw new Error("CONFLITO_FISCAL: já existe documento ativo de outro provedor para este pedido.");
    }
    existing = activeOrderDoc;
  }

  const snapshot = {
    blingInvoiceId: invoiceId,
    rawStatus: externalStatus,
    numero: number,
    serie: series,
    chaveAcesso: accessKey,
    protocolo: protocol,
    linkDanfe,
    linkXml,
  };

  const row:any = {
    tenant_id: input.tenantId,
    branch_id: settings.branch_id,
    order_id: order.id,
    model: "55",
    environment: settings.environment ?? "production",
    series,
    number,
    status,
    access_key: accessKey,
    protocol,
    issued_at: issuedAt,
    authorized_at: status === "authorized" ? (authorizedAt ?? new Date().toISOString()) : null,
    cancelled_at: status === "cancelled" ? new Date().toISOString() : null,
    cancellation_reason: status === "cancelled"
      ? String(pick(note,["motivoCancelamento","cancelamento.motivo"]) ?? "") || null
      : null,
    recipient_name: order.customer_name || "Cliente",
    recipient_tax_id: order.customer_document ?? null,
    recipient_email: order.customer_email ?? null,
    recipient_phone: order.customer_phone ?? null,
    recipient_address: {},
    totals: { total: Number(order.total ?? 0) },
    tax_totals: {},
    provider: "bling",
    provider_reference: invoiceId,
    document_url: linkDanfe,
    xml_url: linkXml,
    last_synced_at: new Date().toISOString(),
    external_payload: snapshot,
    last_error_code: null,
    last_error_message: null,
    updated_by: input.userId,
    updated_at: new Date().toISOString(),
  };

  let documentId = existing?.id ?? null;
  if (documentId) {
    const { error } = await db.from("fiscal_documents").update(row)
      .eq("tenant_id",input.tenantId).eq("id",documentId);
    if (error) throw new Error(error.message);
  } else {
    const { data: created, error } = await db.from("fiscal_documents").insert({
      ...row,
      idempotency_key: crypto.randomUUID(),
      created_by: input.userId,
    }).select("id").single();
    if (error) throw new Error(error.message);
    documentId = created.id;
  }

  await db.from("orders").update(orderUpdate)
    .eq("tenant_id",input.tenantId).eq("id",order.id);

  const { data: tenant } = await db.from("tenants")
    .select("organization_id").eq("id",input.tenantId).maybeSingle();
  if (tenant?.organization_id) {
    await db.from("audit_events").insert({
      organization_id: tenant.organization_id,
      tenant_id: input.tenantId,
      actor_user_id: input.userId,
      action: "fiscal.bling_synced",
      resource_type: "order",
      resource_id: order.id,
      after_data: { invoiceId, status, number, series, accessKey: accessKey ? "present" : null },
      metadata: { provider:"bling", fiscalDocumentId:documentId },
    });
  }

  return {
    ok:true,
    state:"synced",
    documentId,
    invoiceId,
    status,
    number,
    series,
    accessKey,
    protocol,
    documentUrl:linkDanfe,
    xmlUrl:linkXml,
  };
}

export const getOrderFiscalTrace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireTenantRole(context.supabase as any, context.userId, context.tenantId, [...READ_ROLES]);
    const db = supabaseAdmin as any;
    const [{ data: order, error: orderError }, { data: docs, error: docsError }] = await Promise.all([
      db.from("orders")
        .select("id,status,bling_id,bling_number,bling_sync_status,bling_sync_error,bling_invoice_id,bling_invoice_status,bling_invoice_generated_at,bling_invoice_authorized_at,bling_invoice_submitted_at")
        .eq("tenant_id",context.tenantId).eq("id",data.orderId).maybeSingle(),
      db.from("fiscal_documents")
        .select("id,order_id,model,environment,series,number,status,access_key,protocol,authorized_at,cancelled_at,provider,provider_reference,last_error_code,last_error_message,document_url,xml_url,last_synced_at,created_at,updated_at")
        .eq("tenant_id",context.tenantId).eq("order_id",data.orderId)
        .order("created_at",{ascending:false}),
    ]);
    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido não encontrado.");
    if (docsError) throw new Error(docsError.message);
    return { order, documents: docs ?? [] };
  });

export const syncOrderFiscalFromBling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireTenantRole(context.supabase as any, context.userId, context.tenantId, [...SYNC_ROLES]);
    return syncOrderFiscalInternal({
      tenantId: context.tenantId,
      userId: context.userId,
      orderId: data.orderId,
    });
  });

export const syncPendingFiscalFromBling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ limit: z.number().int().min(1).max(25).optional().default(10) }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await requireTenantRole(context.supabase as any, context.userId, context.tenantId, ["owner","admin","manager"]);
    const db = supabaseAdmin as any;
    const { data: orders, error } = await db.from("orders")
      .select("id")
      .eq("tenant_id",context.tenantId)
      .not("bling_id","is",null)
      .in("status",["pago","faturado","enviado","entregue"])
      .order("updated_at",{ascending:false})
      .limit(data.limit);
    if (error) throw new Error(error.message);

    const token = await getBlingAccessToken(context.tenantId);
    const results:any[]=[];
    for (const order of orders ?? []) {
      try {
        const result = await syncOrderFiscalInternal({
          tenantId:context.tenantId,
          userId:context.userId,
          orderId:order.id,
          token,
        });
        results.push({ orderId:order.id, ok:true, state:result.state });
      } catch (error:any) {
        results.push({ orderId:order.id, ok:false, error:String(error?.message ?? error).slice(0,240) });
      }
    }
    return {
      checked:results.length,
      success:results.filter(r=>r.ok).length,
      failed:results.filter(r=>!r.ok).length,
      results,
    };
  });


export async function syncBlingFiscalTraceWorker(limitPerTenant = 20) {
  const db = supabaseAdmin as any;
  const { data: configs, error: cfgError } = await db.from("bling_config")
    .select("tenant_id")
    .eq("active",true);
  if (cfgError) throw new Error(cfgError.message);

  const report = { tenants:0, checked:0, synced:0, waiting:0, failed:0, errors:[] as string[] };
  for (const cfg of configs ?? []) {
    report.tenants += 1;
    try {
      const token = await getBlingAccessToken(cfg.tenant_id);
      const { data: orders, error } = await db.from("orders")
        .select("id")
        .eq("tenant_id",cfg.tenant_id)
        .not("bling_id","is",null)
        .in("status",["pago","faturado","enviado","entregue"])
        .order("updated_at",{ascending:false})
        .limit(limitPerTenant);
      if (error) throw new Error(error.message);
      for (const order of orders ?? []) {
        report.checked += 1;
        try {
          const result:any = await syncOrderFiscalInternal({
            tenantId:cfg.tenant_id,
            userId:null,
            orderId:order.id,
            token,
          });
          if (result.state === "synced") report.synced += 1;
          else report.waiting += 1;
        } catch (error:any) {
          report.failed += 1;
          report.errors.push(String(error?.message ?? error).slice(0,220));
        }
      }
    } catch (error:any) {
      report.failed += 1;
      report.errors.push("tenant " + cfg.tenant_id + ": " + String(error?.message ?? error).slice(0,180));
    }
  }
  return report;
}
