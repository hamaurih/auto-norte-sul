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


async function blingJson(
  method: "POST" | "PUT" | "PATCH",
  path: string,
  token: string,
  body?: unknown,
) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      "Content-Type": "application/json",
      "enable-jwt": "1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = String(
      payload?.error?.description ??
      payload?.error?.message ??
      payload?.message ??
      payload?.errors?.[0]?.message ??
      "",
    ).slice(0,500);
    const error = new Error("Bling HTTP " + res.status + " em " + path + (detail ? ": " + detail : ""));
    (error as any).httpStatus = res.status;
    (error as any).payload = payload;
    throw error;
  }
  return payload?.data ?? payload;
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function extractRemoteOrderTotal(remoteOrder: any) {
  const direct = pick(remoteOrder, ["total","totalVenda","valorTotal","totalPedido"]);
  if (direct != null && Number.isFinite(Number(direct))) return money(direct);
  const products = pick(remoteOrder, ["totalProdutos","valorProdutos"]);
  const discount = pick(remoteOrder, ["desconto.valor","desconto","valorDesconto"]);
  const freight = pick(remoteOrder, ["transporte.frete","frete","valorFrete"]);
  if (products != null) return money(Number(products) - Number(discount ?? 0) + Number(freight ?? 0));
  return null;
}

function remoteOrderLines(remoteOrder: any) {
  const raw = Array.isArray(remoteOrder?.itens) ? remoteOrder.itens : [];
  return raw.map((item:any) => ({
    productId: String(pick(item, ["produto.id","idProduto"]) ?? ""),
    quantity: Number(pick(item, ["quantidade","qtd"]) ?? 0),
    unitValue: money(pick(item, ["valor","valorUnitario","preco"]) ?? 0),
  })).filter((item:any) => item.productId && item.quantity > 0);
}

function assertReceiptMatchesRemoteOrder(receipt: any, remoteOrder: any, orderId: string) {
  const expectedStoreNumber = "NS-" + orderId;
  const remoteStoreNumber = String(pick(remoteOrder, ["numeroLoja","numeroPedidoLoja"]) ?? "");
  if (remoteStoreNumber && remoteStoreNumber !== expectedStoreNumber) {
    throw new Error("FISCAL_RECEIPT_MISMATCH: pedido Bling não corresponde ao recibo ERP.");
  }

  const receiptTotal = money(receipt?.sale_snapshot?.total);
  const remoteTotal = extractRemoteOrderTotal(remoteOrder);
  if (remoteTotal != null && Math.abs(receiptTotal - remoteTotal) > 0.01) {
    throw new Error("FISCAL_RECEIPT_MISMATCH: total do pedido Bling diverge do recibo imutável.");
  }

  const receiptLines = Array.isArray(receipt?.items_snapshot) ? receipt.items_snapshot : [];
  const remoteLines = remoteOrderLines(remoteOrder);
  if (remoteLines.length) {
    if (remoteLines.length !== receiptLines.length) {
      throw new Error("FISCAL_RECEIPT_MISMATCH: quantidade de itens no Bling diverge do recibo.");
    }
    for (const line of receiptLines) {
      const productId = String(line?.bling_id ?? line?.product_bling_id ?? "");
      const qty = Number(line?.quantity ?? 0);
      const unit = money(line?.unit_price);
      if (!productId) continue;
      const remote = remoteLines.find((x:any) => x.productId === productId);
      if (!remote || Math.abs(remote.quantity - qty) > 0.0001 || Math.abs(remote.unitValue - unit) > 0.01) {
        throw new Error("FISCAL_RECEIPT_MISMATCH: item do Bling diverge do recibo imutável.");
      }
    }
  }
}

async function auditFiscalCommand(tenantId:string,userId:string|null,action:string,resourceId:string,afterData:any) {
  const db = supabaseAdmin as any;
  const { data: tenant } = await db.from("tenants").select("organization_id").eq("id",tenantId).maybeSingle();
  if (!tenant?.organization_id) return;
  await db.from("audit_events").insert({
    organization_id:tenant.organization_id,
    tenant_id:tenantId,
    actor_user_id:userId,
    action,
    resource_type:"sales_receipt",
    resource_id:resourceId,
    after_data:afterData,
  });
}

async function fiscalContext(tenantId: string, orderId: string) {
  const db = supabaseAdmin as any;
  const [{ data: order, error: orderError }, { data: settings, error: settingsError }, { data: receipt, error: receiptError }] = await Promise.all([
    db.from("orders")
      .select("id,tenant_id,status,total,customer_name,customer_document,customer_email,customer_phone,bling_id,bling_invoice_id,bling_invoice_status")
      .eq("tenant_id",tenantId).eq("id",orderId).maybeSingle(),
    db.from("fiscal_settings")
      .select("id,branch_id,environment")
      .eq("tenant_id",tenantId)
      .order("created_at",{ascending:true})
      .limit(1)
      .maybeSingle(),
    db.from("sales_receipts")
      .select("id,receipt_code,snapshot_hash")
      .eq("tenant_id",tenantId)
      .eq("order_id",orderId)
      .maybeSingle(),
  ]);
  if (orderError) throw new Error(orderError.message);
  if (!order) throw new Error("Pedido não encontrado.");
  if (settingsError) throw new Error(settingsError.message);
  if (receiptError) throw new Error(receiptError.message);
  return { order, settings, receipt };
}

async function syncOrderFiscalInternal(input: {
  tenantId: string;
  userId: string | null;
  orderId: string;
  token?: string;
}) {
  const db = supabaseAdmin as any;
  const { order, settings, receipt } = await fiscalContext(input.tenantId, input.orderId);

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
    receiptId: receipt?.id ?? null,
    receiptCode: receipt?.receipt_code ?? null,
    receiptSnapshotHash: receipt?.snapshot_hash ?? null,
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
    receipt_id: receipt?.id ?? null,
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


export const issueReceiptNfeViaBling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    receiptId: z.string().uuid(),
    sendEmail: z.boolean().optional().default(false),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await requireTenantRole(context.supabase as any, context.userId, context.tenantId, [...SYNC_ROLES]);
    const db = supabaseAdmin as any;

    const { data: claimed, error: claimError } = await (context.supabase as any).rpc("claim_bling_nfe_emission", {
      p_receipt_id: data.receiptId,
    });
    if (claimError) throw new Error(claimError.message);

    const { data: receipt, error: receiptError } = await db.from("sales_receipts")
      .select("id,tenant_id,order_id,receipt_code,snapshot_hash,sale_snapshot,items_snapshot,payments_snapshot")
      .eq("tenant_id",context.tenantId)
      .eq("id",data.receiptId)
      .maybeSingle();
    if (receiptError) throw new Error(receiptError.message);
    if (!receipt) throw new Error("Recibo não encontrado.");

    const { data: order, error: orderError } = await db.from("orders")
      .select("id,status,bling_id,bling_invoice_id,bling_invoice_status")
      .eq("tenant_id",context.tenantId)
      .eq("id",receipt.order_id)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido do recibo não encontrado.");
    if (!order.bling_id) throw new Error("Pedido ainda não possui vínculo com o Bling.");

    if (claimed?.reused && claimed?.remote_invoice_id) {
      const synced = await syncOrderFiscalInternal({
        tenantId:context.tenantId,
        userId:context.userId,
        orderId:order.id,
      });
      return { ok:true, reused:true, commandId:claimed.command_id, ...synced };
    }
    if (claimed?.reused && ["creating","created","submitting","processing","authorized"].includes(String(claimed?.status))) {
      if (order.bling_invoice_id) {
        const synced = await syncOrderFiscalInternal({
          tenantId:context.tenantId,
          userId:context.userId,
          orderId:order.id,
        });
        return { ok:true, reused:true, commandId:claimed.command_id, ...synced };
      }
      throw new Error("EMISSAO_EM_ANDAMENTO: já existe um comando fiscal para este recibo.");
    }

    const commandId = String(claimed?.command_id ?? "");
    if (!commandId) throw new Error("Não foi possível reservar o comando de emissão.");

    const token = await getBlingAccessToken(context.tenantId);
    let createPostStarted = false;
    let knownInvoiceId = "";

    try {
      const remoteOrder = await blingGet("/pedidos/vendas/" + encodeURIComponent(String(order.bling_id)), token);
      const receiptProductIds = (Array.isArray(receipt.items_snapshot) ? receipt.items_snapshot : [])
        .map((line:any) => String(line?.product_id ?? ""))
        .filter(Boolean);
      let receiptForCheck = receipt;
      if (receiptProductIds.length) {
        const { data: mappedProducts, error: mappedError } = await db.from("products")
          .select("id,bling_id")
          .eq("tenant_id",context.tenantId)
          .in("id",receiptProductIds);
        if (mappedError) throw new Error(mappedError.message);
        const byId = new Map((mappedProducts ?? []).map((p:any) => [String(p.id), String(p.bling_id ?? "")]));
        receiptForCheck = {
          ...receipt,
          items_snapshot:(receipt.items_snapshot ?? []).map((line:any) => ({
            ...line,
            product_bling_id:byId.get(String(line?.product_id ?? "")) || null,
          })),
        };
      }
      assertReceiptMatchesRemoteOrder(receiptForCheck, remoteOrder, order.id);

      const existingInvoiceId = String(extractInvoiceId(remoteOrder) ?? order.bling_invoice_id ?? "").trim();
      let invoiceId = existingInvoiceId;

      if (!invoiceId) {
        const natureza = pick(remoteOrder, [
          "naturezaOperacao.descricao",
          "naturezaOperacao.nome",
          "naturezaOperacao",
        ]);
        const payload:any = {
          pedidoVendaId: Number(order.bling_id),
          tipo: 1,
        };
        if (typeof natureza === "string" && natureza.trim()) payload.naturezaOperacao = natureza.trim();

        createPostStarted = true;
        const created = await blingJson("POST","/nfe",token,payload);
        invoiceId = String(pick(created,["id","idNotaFiscal","notaFiscal.id"]) ?? "").trim();
        knownInvoiceId = invoiceId;
        if (!invoiceId) {
          await db.from("fiscal_emission_commands").update({
            status:"failed",
            last_error:"Bling criou/recebeu a requisição de NF-e sem devolver identificador.",
            response_snapshot:{ stage:"create", response:created },
            finished_at:new Date().toISOString(),
            updated_at:new Date().toISOString(),
          }).eq("tenant_id",context.tenantId).eq("id",commandId);
          throw new Error("Resposta do Bling não trouxe o ID da NF-e. Confira no Bling antes de tentar novamente.");
        }

        await db.from("fiscal_emission_commands").update({
          status:"created",
          remote_invoice_id:invoiceId,
          response_snapshot:{ stage:"created", response:created },
          updated_at:new Date().toISOString(),
        }).eq("tenant_id",context.tenantId).eq("id",commandId);

        await db.from("orders").update({
          bling_invoice_id:invoiceId,
          bling_invoice_status:"criada",
          bling_invoice_generated_at:new Date().toISOString(),
          updated_at:new Date().toISOString(),
        }).eq("tenant_id",context.tenantId).eq("id",order.id);

        await auditFiscalCommand(context.tenantId,context.userId,"fiscal.bling_invoice_created",receipt.id,{
          receiptCode:receipt.receipt_code,
          snapshotHash:receipt.snapshot_hash,
          orderId:order.id,
          blingOrderId:order.bling_id,
          blingInvoiceId:invoiceId,
        });
      } else {
        await db.from("fiscal_emission_commands").update({
          status:"created",
          remote_invoice_id:invoiceId,
          response_snapshot:{ stage:"reconciled_existing" },
          updated_at:new Date().toISOString(),
        }).eq("tenant_id",context.tenantId).eq("id",commandId);
      }

      await db.from("fiscal_emission_commands").update({
        status:"submitting",
        updated_at:new Date().toISOString(),
      }).eq("tenant_id",context.tenantId).eq("id",commandId);

      const sendPath = "/nfe/" + encodeURIComponent(invoiceId) + "/enviar?enviarEmail=" + (data.sendEmail ? "true" : "false");
      const submit = await blingJson("POST",sendPath,token);

      await db.from("fiscal_emission_commands").update({
        status:"processing",
        submitted_at:new Date().toISOString(),
        response_snapshot:{ stage:"submitted", response:submit },
        updated_at:new Date().toISOString(),
      }).eq("tenant_id",context.tenantId).eq("id",commandId);

      await db.from("orders").update({
        bling_invoice_id:invoiceId,
        bling_invoice_status:"processando_sefaz",
        bling_invoice_submitted_at:new Date().toISOString(),
        updated_at:new Date().toISOString(),
      }).eq("tenant_id",context.tenantId).eq("id",order.id);

      await auditFiscalCommand(context.tenantId,context.userId,"fiscal.bling_invoice_submitted",receipt.id,{
        receiptCode:receipt.receipt_code,
        blingInvoiceId:invoiceId,
        sendEmail:data.sendEmail,
      });

      let final:any = null;
      for (const delay of [800,1400,2200]) {
        await new Promise((resolve) => setTimeout(resolve,delay));
        try {
          final = await blingGet("/nfe/" + encodeURIComponent(invoiceId),token);
          const normalized = normalizedStatus(final);
          if (["authorized","rejected","denied","cancelled"].includes(normalized)) break;
        } catch {
          // A submissão já foi aceita; consulta será retomada pela sincronização periódica.
        }
      }

      const synced = await syncOrderFiscalInternal({
        tenantId:context.tenantId,
        userId:context.userId,
        orderId:order.id,
        token,
      });

      const commandStatus =
        synced.status === "authorized" ? "authorized" :
        ["rejected","denied"].includes(String(synced.status)) ? "rejected" :
        synced.status === "cancelled" ? "cancelled" : "processing";

      await db.from("fiscal_emission_commands").update({
        status:commandStatus,
        remote_invoice_id:invoiceId,
        finished_at:commandStatus === "processing" ? null : new Date().toISOString(),
        last_error:commandStatus === "rejected" ? "NF-e rejeitada/denegada pelo fluxo fiscal." : null,
        response_snapshot:{ stage:"synced", result:synced },
        updated_at:new Date().toISOString(),
      }).eq("tenant_id",context.tenantId).eq("id",commandId);

      return {
        ok:true,
        reused:Boolean(existingInvoiceId),
        commandId,
        invoiceId,
        state:commandStatus,
        fiscal:synced,
      };
    } catch (error:any) {
      const message = String(error?.message ?? error).slice(0,600);
      const ambiguousCreate = (createPostStarted && !knownInvoiceId) || message.includes("timeout") || message.includes("AbortError") || error?.name === "AbortError";
      await db.from("fiscal_emission_commands").update({
        status: ambiguousCreate ? "processing" : "failed",
        last_error:message,
        finished_at:ambiguousCreate ? null : new Date().toISOString(),
        updated_at:new Date().toISOString(),
      }).eq("tenant_id",context.tenantId).eq("id",commandId);
      await auditFiscalCommand(context.tenantId,context.userId,"fiscal.bling_invoice_error",receipt.id,{
        receiptCode:receipt.receipt_code,
        error:message,
        ambiguous:ambiguousCreate,
      });
      throw error;
    }
  });

export const refreshReceiptNfeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ receiptId:z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireTenantRole(context.supabase as any,context.userId,context.tenantId,[...SYNC_ROLES]);
    const db = supabaseAdmin as any;
    const { data: receipt, error } = await db.from("sales_receipts")
      .select("id,order_id")
      .eq("tenant_id",context.tenantId)
      .eq("id",data.receiptId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!receipt) throw new Error("Recibo não encontrado.");
    const result = await syncOrderFiscalInternal({
      tenantId:context.tenantId,
      userId:context.userId,
      orderId:receipt.order_id,
    });
    if (result.invoiceId) {
      const status =
        result.status === "authorized" ? "authorized" :
        ["rejected","denied"].includes(String(result.status)) ? "rejected" :
        result.status === "cancelled" ? "cancelled" : "processing";
      await db.from("fiscal_emission_commands").update({
        status,
        remote_invoice_id:result.invoiceId,
        finished_at:status === "processing" ? null : new Date().toISOString(),
        last_error:status === "rejected" ? "NF-e rejeitada/denegada." : null,
        response_snapshot:{ stage:"refresh", result },
        updated_at:new Date().toISOString(),
      }).eq("tenant_id",context.tenantId).eq("receipt_id",receipt.id);
    }
    return result;
  });

export const downloadReceiptNfeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    receiptId:z.string().uuid(),
    format:z.enum(["pdf","xml"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await requireTenantRole(context.supabase as any,context.userId,context.tenantId,[...READ_ROLES]);
    const db = supabaseAdmin as any;
    const { data: doc, error } = await db.from("fiscal_documents")
      .select("access_key,number,series,status")
      .eq("tenant_id",context.tenantId)
      .eq("receipt_id",data.receiptId)
      .eq("provider","bling")
      .order("created_at",{ascending:false})
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc?.access_key) throw new Error("Chave de acesso da NF-e ainda não disponível.");

    const token = await getBlingAccessToken(context.tenantId);
    const res = await fetch(
      API + "/nfe/documento/" + encodeURIComponent(doc.access_key) + "?formato=" + data.format,
      {
        headers:{ Authorization:"Bearer " + token, "enable-jwt":"1" },
        signal:AbortSignal.timeout(25_000),
      },
    );
    if (!res.ok) throw new Error("Não foi possível baixar o " + data.format.toUpperCase() + " da NF-e (HTTP " + res.status + ").");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 8_000_000) throw new Error("Documento fiscal acima do limite de download pelo ERP.");
    return {
      ok:true,
      contentBase64:buffer.toString("base64"),
      contentType:data.format === "pdf" ? "application/pdf" : "application/xml",
      filename:"NFe-" + String(doc.series ?? "1") + "-" + String(doc.number ?? "documento") + "." + data.format,
    };
  });
