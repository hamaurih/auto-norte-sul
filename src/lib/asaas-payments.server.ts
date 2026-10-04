import { decryptIntegrationSecret } from "@/lib/integration-crypto.server";
import { timingSafeEqual } from "node:crypto";

const PROD_API = "https://api.asaas.com/v3";
const SANDBOX_API = "https://api-sandbox.asaas.com/v3";
type AdminClient = any;
type AsaasEnvironment = "production" | "sandbox";

type AsaasContext = {
  integrationId: string;
  providerId: string;
  apiKey: string;
  environment: AsaasEnvironment;
  baseUrl: string;
  webhookToken: string;
};

async function setting(admin: AdminClient, tenantId: string, integrationId: string, key: string) {
  const { data, error } = await admin.from("integration_settings")
    .select("value_encrypted,is_secret").eq("tenant_id", tenantId).eq("integration_id", integrationId).eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.value_encrypted) return "";
  return data.is_secret ? await decryptIntegrationSecret(data.value_encrypted) : String(data.value_encrypted);
}

async function context(admin: AdminClient, tenantId: string): Promise<AsaasContext> {
  const { data: integration, error } = await admin.from("integrations").select("id").eq("slug", "asaas").maybeSingle();
  if (error) throw new Error(error.message);
  if (!integration?.id) throw new Error("Integração Asaas não cadastrada.");
  const configuredEnvironment = (await setting(admin, tenantId, integration.id, "environment")).trim().toLowerCase();
  const environment: AsaasEnvironment = configuredEnvironment === "production" || configuredEnvironment === "producao" ? "production" : "sandbox";
  // Mantém credenciais totalmente separadas: o Sandbox nunca usa, por engano, a chave de produção.
  const apiKey = (await setting(admin, tenantId, integration.id, environment === "sandbox" ? "sandbox_api_key" : "api_key")).trim();
  if (!apiKey) throw new Error(environment === "sandbox"
    ? "Cadastre a API Key do Sandbox do Asaas antes de testar."
    : "Cadastre a API Key de produção do Asaas antes de cobrar.");
  const { data: provider, error: providerError } = await admin.from("payment_providers")
    .upsert({ tenant_id: tenantId, code: "asaas", display_name: "Asaas", adapter_key: "asaas-v3", environment,
      supported_methods: ["pix", "cartao", "boleto"], capabilities: { checkout: true, hosted_checkout: true, pix: true, credit_card: true, boleto: true, webhook: true, refund: true, pci_card_data_on_erp: false }, priority: 5, active: false, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,code,environment" }).select("id").single();
  if (providerError) throw new Error(providerError.message);
  return { integrationId: integration.id, providerId: provider.id, apiKey, environment, baseUrl: environment === "sandbox" ? SANDBOX_API : PROD_API, webhookToken: (await setting(admin, tenantId, integration.id, "webhook_token")).trim() };
}

async function request(c: AsaasContext, path: string, init: RequestInit = {}) {
  const response = await fetch(`${c.baseUrl}${path}`, { ...init, headers: { Accept: "application/json", "Content-Type": "application/json", access_token: c.apiKey, "User-Agent": "NorteSulERP/1.0", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  const raw = await response.text(); let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { errors: [{ description: raw }] }; }
  if (!response.ok) throw new Error(`Asaas respondeu ${response.status}: ${String(body?.errors?.[0]?.description ?? body?.message ?? "erro na API").slice(0, 500)}`);
  return body;
}

export async function ensureAsaasProviderReady(admin: AdminClient, tenantId: string) {
  const c = await context(admin, tenantId);
  await request(c, "/myAccount", { method: "GET" });
  const now = new Date().toISOString();
  await admin.from("payment_providers").update({ active: false, updated_at: now }).eq("tenant_id", tenantId).neq("id", c.providerId).in("code", ["asaas", "stone", "mercado_pago"]);
  const { error } = await admin.from("payment_providers").update({ active: true, priority: 5, updated_at: now }).eq("id", c.providerId).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  await admin.from("tenant_integration_states").update({ status: "connected", active: true, updated_at: now }).eq("tenant_id", tenantId).eq("integration_id", c.integrationId);
  return c;
}

function todayPlus(days: number) { const d = new Date(); d.setDate(d.getDate() + days); return d.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }); }
function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function method(method: string) { return method === "cartao" ? "CREDIT_CARD" : method === "boleto" ? "BOLETO" : "PIX"; }

async function customerForOrder(c: AsaasContext, order: any) {
  const externalReference = String(order.id);
  const existing = await request(c, `/customers?externalReference=${encodeURIComponent(externalReference)}&limit=1`, { method: "GET" });
  if (existing?.data?.[0]?.id) return existing.data[0].id as string;
  const document = digits(order.customer_document);
  const created = await request(c, "/customers", { method: "POST", body: JSON.stringify({ name: String(order.customer_name), email: String(order.customer_email), cpfCnpj: document, mobilePhone: digits(order.customer_phone), postalCode: digits(order.shipping_zip), address: String(order.shipping_street), addressNumber: String(order.shipping_number), complement: order.shipping_complement || undefined, province: String(order.shipping_neighborhood), externalReference }) });
  if (!created?.id) throw new Error("Asaas não retornou o cliente da cobrança.");
  return created.id as string;
}

export async function createAsaasPayment(admin: AdminClient, tenantId: string, intentId: string, boletoDueDays = 15) {
  const c = await ensureAsaasProviderReady(admin, tenantId);
  const { data: intent, error: intentError } = await admin.from("payment_intents").select("id,order_id,provider_id,method,amount,status,external_id,checkout_url,provider_metadata").eq("tenant_id", tenantId).eq("id", intentId).maybeSingle();
  if (intentError) throw new Error(intentError.message); if (!intent) throw new Error("Intenção de pagamento não encontrada.");
  if (intent.provider_id !== c.providerId) throw new Error("Provider da intenção não corresponde ao Asaas ativo.");
  if (intent.external_id && intent.checkout_url) return intent;
  const { data: order, error: orderError } = await admin.from("orders").select("id,status,customer_name,customer_email,customer_phone,customer_document,shipping_zip,shipping_street,shipping_number,shipping_complement,shipping_neighborhood,is_b2b").eq("tenant_id", tenantId).eq("id", intent.order_id).maybeSingle();
  if (orderError) throw new Error(orderError.message); if (!order || order.status !== "aguardando_pagamento") throw new Error("Pedido não está aguardando pagamento.");
  if (intent.method === "boleto" && (!order.is_b2b || !/^(\d{11}|\d{14})$/.test(digits(order.customer_document)))) throw new Error("Boleto Asaas é exclusivo para cliente B2B aprovado com CPF ou CNPJ válido.");
  if (intent.method === "boleto" && ![15,30,45,60,90,120].includes(boletoDueDays)) throw new Error("Prazo de boleto inválido.");
  const customer = await customerForOrder(c, order);
  const payment = await request(c, "/payments", { method: "POST", body: JSON.stringify({ customer, billingType: method(intent.method), value: Number(intent.amount), dueDate: todayPlus(intent.method === "boleto" ? boletoDueDays : 1), description: `Pedido Norte Sul #${String(order.id).slice(0,8)}`, externalReference: intent.id }) });
  if (!payment?.id || !payment?.invoiceUrl) throw new Error("Asaas não retornou uma cobrança válida.");
  let pix: any = null;
  if (intent.method === "pix") pix = await request(c, `/payments/${encodeURIComponent(payment.id)}/pixQrCode`, { method: "GET", headers: { "Content-Type": "" } });
  const updated = await admin.from("payment_intents").update({ status: "pending", external_id: String(payment.id), checkout_url: String(payment.invoiceUrl), boleto_url: payment.bankSlipUrl ?? null, boleto_barcode: payment.identificationField ?? null, pix_copy_paste: pix?.payload ?? null, pix_qr_code_url: pix?.encodedImage ? `data:image/png;base64,${pix.encodedImage}` : null, expires_at: pix?.expirationDate ?? null, provider_metadata: { ...(intent.provider_metadata ?? {}), asaas_payment_id: payment.id, asaas_customer_id: customer, asaas_environment: c.environment, boleto_due_days: intent.method === "boleto" ? boletoDueDays : undefined }, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", intent.id).select("*").single();
  if (updated.error) throw new Error(updated.error.message); return updated.data;
}

function normalize(status: unknown): string | null { switch (String(status ?? "").toUpperCase()) { case "PENDING": case "AWAITING_RISK_ANALYSIS": return "pending"; case "RECEIVED": case "CONFIRMED": return "paid"; case "OVERDUE": return "expired"; case "REFUNDED": return "refunded"; case "REFUND_REQUESTED": return "partially_refunded"; case "DELETED": case "CANCELED": return "cancelled"; default: return null; } }
async function hash(value: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2,"0")).join(""); }

export async function processAsaasWebhook(admin: AdminClient, rawBody: string, headers: Headers) {
  const payload = JSON.parse(rawBody); const paymentId = String(payload?.payment?.id ?? "");
  if (!paymentId) return { ignored: true, reason: "missing_payment" };
  const { data: intent, error } = await admin.from("payment_intents").select("id,tenant_id,provider_id,amount").eq("external_id", paymentId).maybeSingle();
  if (error) throw new Error(error.message); if (!intent) return { ignored: true, reason: "unknown_payment" };
  const c = await context(admin, intent.tenant_id);
  const receivedToken = headers.get("asaas-access-token") ?? "";
  if (!c.webhookToken || receivedToken.length !== c.webhookToken.length || !timingSafeEqual(Buffer.from(receivedToken), Buffer.from(c.webhookToken))) throw new Error("Webhook Asaas não autenticado.");
  if (intent.provider_id !== c.providerId) throw new Error("Webhook não pertence ao Asaas ativo.");
  const remote = await request(c, `/payments/${encodeURIComponent(paymentId)}`, { method: "GET", headers: { "Content-Type": "" } });
  if (String(remote?.externalReference) !== intent.id) throw new Error("Correlação Asaas inválida.");
  if (Number(remote?.value) !== Number(intent.amount)) throw new Error("Valor Asaas diverge do pedido.");
  const status = normalize(remote?.status); if (!status) return { ignored: true, reason: "unsupported_status" };
  const eventId = String(payload?.id ?? `${payload?.event}:${paymentId}:${remote?.status}:${remote?.confirmedDate ?? remote?.paymentDate ?? ""}`);
  const { error: updateError } = await admin.from("payment_intents").update({ provider_metadata: { asaas_payment_id: paymentId, asaas_last_event: payload?.event ?? null, asaas_status: remote?.status ?? null }, updated_at: new Date().toISOString() }).eq("id", intent.id).eq("tenant_id", intent.tenant_id);
  if (updateError) throw new Error(updateError.message);
  const { data, error: applyError } = await admin.rpc("internal_apply_payment_webhook", { p_provider_id: c.providerId, p_provider_event_id: eventId.slice(0,255), p_event_type: String(payload?.event ?? "PAYMENT_UPDATED").slice(0,120), p_external_payment_id: paymentId, p_normalized_status: status, p_payload_sha256: await hash(rawBody), p_signature_verified: true });
  if (applyError) throw new Error(applyError.message); return { ignored: false, normalizedStatus: status, result: data };
}
