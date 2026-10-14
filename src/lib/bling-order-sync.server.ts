import { getBlingCredentials } from "./bling.functions";

const BLING_API = "https://api.bling.com.br/Api/v3";
const TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";
const MIN_INTERVAL_MS = 450;
const MAX_HTTP_ATTEMPTS = 4;
let lastRequestAt = 0;
let rateChain: Promise<void> = Promise.resolve();

type JobEvent = "created" | "paid" | "cancelled";
type ClaimedJob = {
  job_id: string;
  tenant_id: string;
  order_id: string;
  event_type: JobEvent;
  attempts: number;
};

type OrderRow = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  status: string;
  created_at: string;
  subtotal: number | string;
  shipping: number | string;
  discount: number | string;
  total: number | string;
  payment_method: string;
  payment_due_days?: number | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_document: string | null;
  shipping_zip: string | null;
  shipping_street: string | null;
  shipping_number: string | null;
  shipping_complement: string | null;
  shipping_neighborhood: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  notes: string | null;
  fulfillment_type: string | null;
  bling_id: string | null;
  bling_number: string | null;
  bling_sync_status: string | null;
  bling_stock_launched_at: string | null;
  bling_accounts_launched_at: string | null;
  bling_invoice_id: string | null;
  bling_invoice_status: string | null;
  bling_invoice_generated_at: string | null;
  bling_invoice_authorized_at: string | null;
};

type OrderItem = {
  id: string;
  product_id: string | null;
  sku: string | null;
  name: string;
  quantity: number;
  unit_price: number | string;
  list_price: number | string | null;
  total: number | string;
  product: {
    id: string;
    bling_id: string | null;
    gtin: string | null;
    manufacturer_code: string | null;
  } | null;
};

export type BlingOrderSyncWorkerResult = {
  ok: boolean;
  claimed: number;
  done: number;
  requeued: number;
  failed: number;
  details: Array<{ jobId: string; orderId: string; event: JobEvent; status: string; message: string }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const money = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
};

function localDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateValue: string, days: number) {
  const base = new Date(`${dateValue}T12:00:00-03:00`);
  base.setUTCDate(base.getUTCDate() + Math.max(0, days));
  return localDate(base);
}

function orderReference(orderId: string) {
  return `NS-${orderId}`;
}

function safeApiMessage(body: any, fallback: string) {
  const value = body?.error?.description ?? body?.error?.message ?? body?.message ?? body?.error ?? fallback;
  return String(typeof value === "string" ? value : JSON.stringify(value)).slice(0, 900);
}

function rateLimited<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = rateChain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  rateChain = scheduled.catch(() => undefined);
  return scheduled.then(task);
}

async function refreshBlingToken(admin: any, tenantId: string) {
  const { data: cfg, error } = await admin
    .from("bling_config")
    .select("id,tenant_id,active,access_token,refresh_token,expires_at,client_id,client_secret_encrypted")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`Bling config: ${error.message}`);
  if (!cfg?.active) throw new Error("Integração Bling está inativa");
  if (!cfg.access_token) throw new Error("Bling sem access_token; reautorize a integração");

  const expiresAt = cfg.expires_at ? new Date(cfg.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return String(cfg.access_token);
  if (!cfg.refresh_token) throw new Error("Token Bling expirado e sem refresh_token");

  const credentials = await getBlingCredentials(admin, tenantId, cfg);
  if (!credentials.clientId || !credentials.clientSecret) throw new Error("Credenciais OAuth do Bling não configuradas");
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, "utf8").toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
      accept: "1.0",
      "enable-jwt": "1",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(cfg.refresh_token) }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as any;
  if (!response.ok || !body?.access_token) {
    throw new Error(`Falha ao renovar token do Bling (${response.status}): ${safeApiMessage(body, "sem detalhes")}`);
  }

  const expires = new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString();
  const { error: updateError } = await admin.from("bling_config").update({
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? cfg.refresh_token,
    expires_at: expires,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", cfg.id);
  if (updateError) throw new Error(`Falha ao persistir token renovado: ${updateError.message}`);
  return String(body.access_token);
}

async function blingRequest(
  token: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  options?: { allow404?: boolean; acceptAlreadyProcessed?: boolean },
): Promise<any> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt += 1) {
    const response = await rateLimited(() => fetch(`${BLING_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
        "enable-jwt": "1",
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    }));

    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`Bling ${method} ${path}: HTTP ${response.status}`);
      if (attempt < MAX_HTTP_ATTEMPTS - 1) {
        const retry = Number(response.headers.get("retry-after") ?? 0);
        await sleep(retry > 0 ? Math.min(retry * 1000, 30_000) : 1000 * 2 ** attempt);
        continue;
      }
    }

    if (response.status === 404 && options?.allow404) return null;
    const text = response.status === 204 ? "" : await response.text();
    const parsed = text ? (() => { try { return JSON.parse(text); } catch { return { message: text }; } })() : null;

    if (!response.ok) {
      const message = safeApiMessage(parsed, `HTTP ${response.status}`);
      if (options?.acceptAlreadyProcessed && response.status === 400 && /(j[aá]\s+)?(lan[çc]ad|gerad|processad|baixad|estornad|emitid)/i.test(message)) {
        return { alreadyProcessed: true, message };
      }
      throw new Error(`Bling ${method} ${path}: HTTP ${response.status} — ${message}`);
    }
    return parsed?.data ?? parsed;
  }
  throw lastError ?? new Error(`Bling ${method} ${path}: falha inesperada`);
}

async function loadOrder(admin: any, tenantId: string, orderId: string) {
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,tenant_id,customer_id,status,created_at,subtotal,shipping,discount,total,payment_method,payment_due_days,customer_name,customer_email,customer_phone,customer_document,shipping_zip,shipping_street,shipping_number,shipping_complement,shipping_neighborhood,shipping_city,shipping_state,notes,fulfillment_type,bling_id,bling_number,bling_sync_status,bling_stock_launched_at,bling_accounts_launched_at,bling_invoice_id,bling_invoice_status,bling_invoice_generated_at,bling_invoice_authorized_at")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!order) throw new Error("Pedido local não encontrado");

  const { data: items, error: itemError } = await admin
    .from("order_items")
    .select("id,product_id,sku,name,quantity,unit_price,list_price,total,product:products(id,bling_id,gtin,manufacturer_code)")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .order("id");
  if (itemError) throw new Error(itemError.message);
  if (!items?.length) throw new Error("Pedido local sem itens");
  return { order: order as OrderRow, items: items as unknown as OrderItem[] };
}

async function logSync(admin: any, tenantId: string, orderId: string, action: string, status: "pendente" | "sucesso" | "erro", message: string, response?: unknown) {
  await admin.from("bling_sync_logs").insert({
    tenant_id: tenantId,
    entity: "pedido",
    entity_id: orderId,
    action,
    status,
    message: message.slice(0, 1000),
    response: response == null ? null : response,
  }).then(() => undefined, () => undefined);
}

async function ensureContact(admin: any, token: string, order: OrderRow) {
  if (order.customer_id) {
    const { data } = await admin.from("customers").select("id,bling_id").eq("tenant_id", order.tenant_id).eq("id", order.customer_id).maybeSingle();
    if (data?.bling_id && Number(data.bling_id) > 0) return Number(data.bling_id);
  }

  const document = digits(order.customer_document);
  if (!document) throw new Error("Cliente sem CPF/CNPJ para sincronizar com o Bling");
  const list = await blingRequest(token, `/contatos?limite=20&numeroDocumento=${encodeURIComponent(document)}`);
  const found = (Array.isArray(list) ? list : []).find((row: any) => digits(row?.numeroDocumento) === document);
  if (found?.id) {
    if (order.customer_id) await admin.from("customers").update({ bling_id: Number(found.id) }).eq("tenant_id", order.tenant_id).eq("id", order.customer_id);
    return Number(found.id);
  }

  const created = await blingRequest(token, "/contatos", "POST", {
    nome: order.customer_name || `Cliente ${document}`,
    situacao: "A",
    numeroDocumento: document,
    celular: order.customer_phone || undefined,
    email: order.customer_email || undefined,
    emailNotaFiscal: order.customer_email || undefined,
    tipo: document.length === 14 ? "J" : "F",
    indicadorIe: 9,
  });
  const id = Number(created?.id);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Bling criou/retornou contato sem ID válido");
  if (order.customer_id) await admin.from("customers").update({ bling_id: id }).eq("tenant_id", order.tenant_id).eq("id", order.customer_id);
  return id;
}

function paymentTypes(method: string) {
  if (method === "pix") return [17, 20];
  if (method === "cartao") return [3];
  if (method === "boleto") return [15];
  if (method === "faturado_b2b") return [14];
  return [99];
}

async function resolvePaymentForm(token: string, method: string) {
  for (const type of paymentTypes(method)) {
    const list = await blingRequest(token, `/formas-pagamentos?limite=100&situacao=1&tiposPagamentos%5B%5D=${type}`);
    const active = (Array.isArray(list) ? list : []).find((row: any) => Number(row?.tipoPagamento) === type && Number(row?.situacao ?? 1) === 1 && [2, 3].includes(Number(row?.finalidade ?? 3)));
    if (active?.id) return Number(active.id);
  }
  throw new Error(`Nenhuma forma de pagamento ativa no Bling para ${method}`);
}

async function findExistingSale(token: string, orderId: string) {
  const reference = orderReference(orderId);
  const list = await blingRequest(token, `/pedidos/vendas?limite=10&numerosLojas%5B%5D=${encodeURIComponent(reference)}`);
  const match = (Array.isArray(list) ? list : []).find((row: any) => String(row?.numeroLoja ?? "") === reference);
  return match?.id ? match : null;
}

async function persistSaleReference(admin: any, order: OrderRow, sale: any) {
  const id = String(sale?.id ?? "").trim();
  if (!id) throw new Error("Pedido Bling sem ID válido");
  const number = sale?.numero == null ? null : String(sale.numero);
  const { error } = await admin.from("orders").update({
    bling_id: id,
    bling_number: number,
    bling_sync_status: "synced",
    bling_sync_error: null,
    bling_last_sync_at: new Date().toISOString(),
  }).eq("tenant_id", order.tenant_id).eq("id", order.id);
  if (error) throw new Error(error.message);
  order.bling_id = id;
  order.bling_number = number;
  return id;
}

async function ensureSale(admin: any, token: string, order: OrderRow, items: OrderItem[]) {
  if (order.bling_id) return String(order.bling_id);

  const existing = await findExistingSale(token, order.id);
  if (existing?.id) return persistSaleReference(admin, order, existing);

  const contactId = await ensureContact(admin, token, order);
  const paymentFormId = await resolvePaymentForm(token, order.payment_method);
  const missing = items.filter((item) => !item.product?.bling_id || Number(item.product.bling_id) <= 0);
  if (missing.length) {
    throw new Error(`Produto(s) sem vínculo Bling: ${missing.slice(0, 5).map((item) => item.sku || item.name).join(", ")}`);
  }

  const date = localDate(order.created_at);
  const dueDays = order.payment_method === "pix" || order.payment_method === "cartao"
    ? 0
    : Number(order.payment_due_days ?? 15);
  const reference = orderReference(order.id);
  const payload = {
    numeroLoja: reference,
    data: date,
    dataSaida: date,
    dataPrevista: date,
    contato: { id: contactId, nome: order.customer_name || "Cliente" },
    itens: items.map((item) => ({
      id: 0,
      codigo: item.sku || undefined,
      unidade: "UN",
      quantidade: Number(item.quantity),
      valor: money(item.unit_price),
      valorLista: money(item.list_price ?? item.unit_price),
      descricao: item.name,
      produto: { id: Number(item.product!.bling_id) },
    })),
    parcelas: [{
      id: 0,
      dataVencimento: addDays(date, dueDays),
      valor: money(order.total),
      observacoes: `Venda do site Norte Sul — ${reference}`,
      formaPagamento: { id: paymentFormId },
    }],
    desconto: money(order.discount) > 0 ? { valor: money(order.discount), unidade: "REAL" } : undefined,
    transporte: {
      fretePorConta: order.fulfillment_type === "pickup" ? 9 : 0,
      frete: money(order.shipping),
      quantidadeVolumes: 1,
      etiqueta: order.fulfillment_type === "pickup" ? undefined : {
        nome: order.customer_name || "Cliente",
        endereco: order.shipping_street || "",
        numero: order.shipping_number || "",
        complemento: order.shipping_complement || "",
        municipio: order.shipping_city || "",
        uf: order.shipping_state || "",
        cep: digits(order.shipping_zip),
        bairro: order.shipping_neighborhood || "",
      },
    },
    observacoes: order.notes || undefined,
    observacoesInternas: `Origem: e-commerce Norte Sul | Pedido local: ${order.id} | Pagamento: ${order.payment_method}`,
  };

  const created = await blingRequest(token, "/pedidos/vendas", "POST", payload);
  const saleId = await persistSaleReference(admin, order, created);
  await logSync(admin, order.tenant_id, order.id, "storefront_order_created", "sucesso", `Pedido enviado ao Bling (${saleId})`, { bling_id: saleId, bling_number: created?.numero ?? null });
  return saleId;
}

async function launchPaidSale(admin: any, token: string, order: OrderRow, items: OrderItem[]) {
  const saleId = await ensureSale(admin, token, order, items);
  const now = new Date().toISOString();

  if (!order.bling_stock_launched_at) {
    await blingRequest(token, `/pedidos/vendas/${encodeURIComponent(saleId)}/lancar-estoque`, "POST", undefined, { acceptAlreadyProcessed: true });
    const { error } = await admin.from("orders").update({ bling_stock_launched_at: now, bling_last_sync_at: now }).eq("tenant_id", order.tenant_id).eq("id", order.id);
    if (error) throw new Error(error.message);
    order.bling_stock_launched_at = now;
  }

  if (!order.bling_accounts_launched_at) {
    await blingRequest(token, `/pedidos/vendas/${encodeURIComponent(saleId)}/lancar-contas`, "POST", undefined, { acceptAlreadyProcessed: true });
    const { error } = await admin.from("orders").update({ bling_accounts_launched_at: now, bling_last_sync_at: now }).eq("tenant_id", order.tenant_id).eq("id", order.id);
    if (error) throw new Error(error.message);
    order.bling_accounts_launched_at = now;
  }

  let invoiceId = order.bling_invoice_id ? String(order.bling_invoice_id) : null;
  if (!invoiceId) {
    const sale = await blingRequest(token, `/pedidos/vendas/${encodeURIComponent(saleId)}`);
    invoiceId = sale?.notaFiscal?.id ? String(sale.notaFiscal.id) : null;
  }
  if (!invoiceId) {
    const generated = await blingRequest(token, `/pedidos/vendas/${encodeURIComponent(saleId)}/gerar-nfe`, "POST", undefined, { acceptAlreadyProcessed: true });
    invoiceId = generated?.idNotaFiscal ? String(generated.idNotaFiscal) : generated?.id ? String(generated.id) : null;
    if (!invoiceId) {
      const refreshedSale = await blingRequest(token, `/pedidos/vendas/${encodeURIComponent(saleId)}`);
      invoiceId = refreshedSale?.notaFiscal?.id ? String(refreshedSale.notaFiscal.id) : null;
    }
    if (!invoiceId) throw new Error("Bling não retornou o ID da NF-e gerada");
  }

  if (!order.bling_invoice_id || !order.bling_invoice_generated_at) {
    const { error } = await admin.from("orders").update({
      bling_invoice_id: invoiceId,
      bling_invoice_status: "generated",
      bling_invoice_generated_at: now,
      bling_sync_status: "fiscal_pending",
      bling_sync_error: null,
      bling_last_sync_at: now,
    }).eq("tenant_id", order.tenant_id).eq("id", order.id);
    if (error) throw new Error(error.message);
    order.bling_invoice_id = invoiceId;
    order.bling_invoice_generated_at = now;
  }

  let nfe = await blingRequest(token, `/nfe/${encodeURIComponent(invoiceId)}`, "GET", undefined, { allow404: true });
  let situation = Number(nfe?.situacao ?? nfe?.situacao?.valor ?? 0);
  const authorized = [5, 6].includes(situation);
  if (!authorized && order.bling_sync_status !== "fiscal_submitted") {
    await blingRequest(token, `/nfe/${encodeURIComponent(invoiceId)}/enviar?enviarEmail=true`, "POST", undefined, { acceptAlreadyProcessed: true });
    await admin.from("orders").update({ bling_sync_status: "fiscal_submitted", bling_invoice_status: "submitted", bling_last_sync_at: now }).eq("tenant_id", order.tenant_id).eq("id", order.id);
    order.bling_sync_status = "fiscal_submitted";
    await sleep(900);
    nfe = await blingRequest(token, `/nfe/${encodeURIComponent(invoiceId)}`, "GET", undefined, { allow404: true });
    situation = Number(nfe?.situacao ?? nfe?.situacao?.valor ?? 0);
  }

  if ([5, 6].includes(situation)) {
    const { error } = await admin.from("orders").update({
      bling_sync_status: "synced",
      bling_sync_error: null,
      bling_invoice_status: String(situation),
      bling_invoice_authorized_at: now,
      bling_last_sync_at: now,
    }).eq("tenant_id", order.tenant_id).eq("id", order.id);
    if (error) throw new Error(error.message);
    await logSync(admin, order.tenant_id, order.id, "storefront_sale_invoiced", "sucesso", `Venda lançada e NF-e autorizada no Bling (${invoiceId})`, { bling_id: saleId, invoice_id: invoiceId, situacao: situation });
    return { saleId, invoiceId, situation, authorized: true };
  }

  const statusLabel = situation ? String(situation) : "aguardando retorno";
  await admin.from("orders").update({
    bling_sync_status: "fiscal_submitted",
    bling_invoice_status: statusLabel,
    bling_last_sync_at: now,
  }).eq("tenant_id", order.tenant_id).eq("id", order.id);
  throw new Error(`NF-e ${invoiceId} enviada ao Bling/SEFAZ, mas ainda não está autorizada (situação ${statusLabel})`);
}

async function cancelUnpaidSale(admin: any, token: string, order: OrderRow) {
  if (!order.bling_id) {
    const existing = await findExistingSale(token, order.id);
    if (existing?.id) await persistSaleReference(admin, order, existing);
  }
  if (order.bling_id) {
    if (order.bling_stock_launched_at || order.bling_accounts_launched_at || order.bling_invoice_id) {
      throw new Error("Pedido já teve efeitos financeiros/fiscais no Bling; cancelamento exige fluxo fiscal de devolução/cancelamento");
    }
    await blingRequest(token, `/pedidos/vendas/${encodeURIComponent(order.bling_id)}`, "DELETE", undefined, { allow404: true });
  }
  const now = new Date().toISOString();
  const { error } = await admin.from("orders").update({
    bling_sync_status: "cancelled",
    bling_sync_error: null,
    bling_last_sync_at: now,
  }).eq("tenant_id", order.tenant_id).eq("id", order.id);
  if (error) throw new Error(error.message);
  await logSync(admin, order.tenant_id, order.id, "storefront_order_cancelled", "sucesso", "Pedido não pago removido/baixado do fluxo Bling");
}

async function markJobDone(admin: any, jobId: string) {
  await admin.from("bling_order_sync_jobs").update({ status: "done", finished_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
}

async function markJobFailure(admin: any, job: ClaimedJob, message: string) {
  const terminal = job.attempts >= 5;
  const delayMinutes = Math.min(30, Math.max(1, 2 ** Math.max(0, job.attempts - 1)));
  await admin.from("bling_order_sync_jobs").update({
    status: terminal ? "failed" : "queued",
    scheduled_at: terminal ? new Date().toISOString() : new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    finished_at: terminal ? new Date().toISOString() : null,
    started_at: null,
    last_error: message.slice(0, 1500),
    updated_at: new Date().toISOString(),
  }).eq("id", job.job_id);
  await admin.from("orders").update({ bling_sync_status: "error", bling_sync_error: message.slice(0, 1500), bling_last_sync_at: new Date().toISOString() }).eq("tenant_id", job.tenant_id).eq("id", job.order_id);
  await logSync(admin, job.tenant_id, job.order_id, `storefront_${job.event_type}`, "erro", message);
  return terminal;
}

export async function runBlingOrderSyncWorker(limit = 5): Promise<BlingOrderSyncWorkerResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  const { data: claimed, error: claimError } = await admin.rpc("claim_bling_order_sync_jobs", { p_limit: Math.max(1, Math.min(limit, 10)) });
  if (claimError) throw new Error(claimError.message);

  const jobs = (claimed ?? []) as ClaimedJob[];
  const result: BlingOrderSyncWorkerResult = { ok: true, claimed: jobs.length, done: 0, requeued: 0, failed: 0, details: [] };

  for (const job of jobs) {
    try {
      const { order, items } = await loadOrder(admin, job.tenant_id, job.order_id);
      const token = await refreshBlingToken(admin, job.tenant_id);
      await admin.from("orders").update({ bling_sync_status: job.event_type === "paid" ? "fiscal_pending" : "processing", bling_sync_error: null }).eq("tenant_id", job.tenant_id).eq("id", job.order_id);

      if (job.event_type === "created") {
        if (order.status === "cancelado") {
          await cancelUnpaidSale(admin, token, order);
        } else {
          await ensureSale(admin, token, order, items);
        }
      } else if (job.event_type === "paid") {
        if (order.status !== "pago" && !["faturado", "enviado", "entregue"].includes(order.status)) {
          throw new Error(`Evento pago incompatível com status local ${order.status}`);
        }
        await launchPaidSale(admin, token, order, items);
      } else {
        await cancelUnpaidSale(admin, token, order);
      }

      await markJobDone(admin, job.job_id);
      result.done += 1;
      result.details.push({ jobId: job.job_id, orderId: job.order_id, event: job.event_type, status: "done", message: "Sincronizado" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada na sincronização Bling";
      const terminal = await markJobFailure(admin, job, message);
      if (terminal) result.failed += 1; else result.requeued += 1;
      result.details.push({ jobId: job.job_id, orderId: job.order_id, event: job.event_type, status: terminal ? "failed" : "requeued", message });
    }
  }

  result.ok = result.failed === 0;
  return result;
}
