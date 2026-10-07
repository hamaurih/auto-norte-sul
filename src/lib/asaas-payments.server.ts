import { decryptIntegrationSecret } from "@/lib/integration-crypto.server";
import { timingSafeEqual } from "node:crypto";

const PROD_API = "https://api.asaas.com/v3";
const SANDBOX_API = "https://api-sandbox.asaas.com/v3";
type AdminClient = any;
type AsaasEnvironment = "production" | "sandbox";

export type AsaasContext = {
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
  // Leitura das credenciais em paralelo: diminui uma ida ao banco no checkout.
  const [apiKeyValue, webhookTokenValue] = await Promise.all([
    setting(admin, tenantId, integration.id, environment === "sandbox" ? "sandbox_api_key" : "api_key"),
    setting(admin, tenantId, integration.id, "webhook_token"),
  ]);
  const apiKey = apiKeyValue.trim();
  if (!apiKey) throw new Error(environment === "sandbox"
    ? "Cadastre a API Key do Sandbox do Asaas antes de testar."
    : "Cadastre a API Key de produção do Asaas antes de cobrar.");

  // O provider só é criado se ainda não existir. Não fazemos upsert/escritas
  // administrativas a cada compra.
  const { data: existingProvider, error: providerLookupError } = await admin.from("payment_providers")
    .select("id,active").eq("tenant_id", tenantId).eq("code", "asaas").eq("environment", environment).maybeSingle();
  if (providerLookupError) throw new Error(providerLookupError.message);
  let providerId = existingProvider?.id as string | undefined;
  if (!providerId) {
    const { data: provider, error: providerError } = await admin.from("payment_providers")
      .upsert({ tenant_id: tenantId, code: "asaas", display_name: "Asaas", adapter_key: "asaas-v3", environment,
        supported_methods: ["pix", "cartao", "boleto"], capabilities: { checkout: true, hosted_checkout: true, pix: true, credit_card: true, boleto: true, webhook: true, refund: true, pci_card_data_on_erp: false }, priority: 5, active: true, updated_at: new Date().toISOString() },
        { onConflict: "tenant_id,code,environment" }).select("id").single();
    if (providerError) throw new Error(providerError.message);
    providerId = provider.id;
  } else if (!existingProvider.active) {
    // Mantém o meio de pagamento disponível sem fazer a verificação externa
    // completa em toda venda.
    const { error: activateError } = await admin.from("payment_providers")
      .update({ active: true, updated_at: new Date().toISOString() })
      .eq("id", providerId).eq("tenant_id", tenantId);
    if (activateError) throw new Error(activateError.message);
  }
  return { integrationId: integration.id, providerId, apiKey, environment, baseUrl: environment === "sandbox" ? SANDBOX_API : PROD_API, webhookToken: webhookTokenValue.trim() };
}

export async function getAsaasPaymentContext(admin: AdminClient, tenantId: string) {
  return context(admin, tenantId);
}

async function request(c: AsaasContext, path: string, init: RequestInit = {}, timeoutMs = 30_000) {
  const response = await fetch(`${c.baseUrl}${path}`, { ...init, headers: { Accept: "application/json", "Content-Type": "application/json", access_token: c.apiKey, "User-Agent": "NorteSulERP/1.0", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
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
// O Asaas aceita CEP brasileiro com 8 dígitos e celular com DDD (10/11 dígitos).
// Mantemos apenas a parte local quando o cliente informou o prefixo +55.
function asaasPostalCode(value: unknown) { return digits(value).slice(0, 8); }
function asaasMobilePhone(value: unknown) { return digits(value).slice(-11); }
function method(method: string) { return method === "cartao" ? "CREDIT_CARD" : method === "boleto" ? "BOLETO" : "PIX"; }

async function customerForOrder(c: AsaasContext, order: any) {
  // Referência estável e sem expor documento: permite reutilizar o mesmo
  // cliente no Asaas nos próximos pedidos, em vez de sempre criar outro.
  const externalReference = `customer:${await hash(digits(order.customer_document))}`;
  const existing = await request(c, `/customers?externalReference=${encodeURIComponent(externalReference)}&limit=1`, { method: "GET" });
  if (existing?.data?.[0]?.id) return existing.data[0].id as string;
  const document = digits(order.customer_document);
  const created = await request(c, "/customers", { method: "POST", body: JSON.stringify({ name: String(order.customer_name), email: String(order.customer_email), cpfCnpj: document, mobilePhone: asaasMobilePhone(order.customer_phone), postalCode: asaasPostalCode(order.shipping_zip), address: String(order.shipping_street), addressNumber: String(order.shipping_number), complement: order.shipping_complement || undefined, province: String(order.shipping_neighborhood), externalReference }) });
  if (!created?.id) throw new Error("Asaas não retornou o cliente da cobrança.");
  return created.id as string;
}

type CardData = { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string };

export async function createAsaasPayment(admin: AdminClient, tenantId: string, intentId: string, boletoDueDays = 15, card?: CardData, remoteIp?: string, installments = 1, readyContext?: AsaasContext) {
  // A validação da conta já foi feita antes da criação da intenção. Reutilizar o contexto evita uma segunda chamada ao Asaas e reduz a espera no checkout.
  const c = readyContext ?? await ensureAsaasProviderReady(admin, tenantId);
  const { data: intent, error: intentError } = await admin.from("payment_intents").select("id,order_id,provider_id,method,amount,status,external_id,checkout_url,pix_copy_paste,pix_qr_code_url,expires_at,provider_metadata").eq("tenant_id", tenantId).eq("id", intentId).maybeSingle();
  if (intentError) throw new Error(intentError.message); if (!intent) throw new Error("Intenção de pagamento não encontrada.");
  if (intent.provider_id !== c.providerId) throw new Error("Provider da intenção não corresponde ao Asaas ativo.");
  // Uma tentativa já registrada não pode criar outra cobrança, inclusive no
  // parcelamento (que não possui URL de fatura). Isso evita cobrança duplicada
  // quando o cliente atualiza a tela ou tenta novamente.
  if (intent.external_id) {
    // Cobranças antigas podem já possuir o ID no Asaas, mas não terem gravado
    // o QR Code. Recuperamos o payload antes de devolver a cobrança ao checkout.
    if (intent.method === "pix" && (!intent.pix_copy_paste || !intent.pix_qr_code_url)) {
      const pix = await request(c, `/payments/${encodeURIComponent(String(intent.external_id))}/pixQrCode`, { method: "GET", headers: { "Content-Type": "" } });
      if (!pix?.payload || !pix?.encodedImage) {
        throw new Error("A cobrança PIX ainda não retornou o QR Code. Tente novamente em instantes.");
      }
      const recovered = await admin.from("payment_intents").update({
        pix_copy_paste: String(pix.payload),
        pix_qr_code_url: `data:image/png;base64,${pix.encodedImage}`,
        expires_at: pix.expirationDate ?? intent.expires_at ?? null,
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenantId).eq("id", intent.id).select("*").single();
      if (recovered.error) throw new Error(recovered.error.message);
      return recovered.data;
    }
    return intent;
  }
  const { data: order, error: orderError } = await admin.from("orders").select("id,status,customer_name,customer_email,customer_phone,customer_document,shipping_zip,shipping_street,shipping_number,shipping_complement,shipping_neighborhood,is_b2b").eq("tenant_id", tenantId).eq("id", intent.order_id).maybeSingle();
  if (orderError) throw new Error(orderError.message); if (!order || order.status !== "aguardando_pagamento") throw new Error("Pedido não está aguardando pagamento.");
  if (intent.method === "boleto" && !/^(\d{11}|\d{14})$/.test(digits(order.customer_document))) throw new Error("Informe CPF ou CNPJ válido para gerar o boleto.");
  // B2C usa vencimento curto; prazos negociados permanecem restritos ao B2B aprovado.
  if (intent.method === "boleto" && (order.is_b2b ? ![15,30,45,60,90,120].includes(boletoDueDays) : boletoDueDays !== 3)) {
    throw new Error(order.is_b2b ? "Prazo de boleto B2B inválido." : "Para cliente B2C, o boleto vence em até 3 dias.");
  }
  const customer = await customerForOrder(c, order);
  if (intent.method === "cartao" && !card) {
    throw new Error("Informe os dados do cartão para concluir o pagamento.");
  }
  const cardNumber = digits(card?.number);
  const expiryMonth = digits(card?.expiryMonth);
  const expiryYear = digits(card?.expiryYear);
  const ccv = digits(card?.ccv);
  if (intent.method === "cartao" && (!cardNumber || !/^\d{1,2}$/.test(expiryMonth) || !/^\d{2,4}$/.test(expiryYear) || !/^\d{3,4}$/.test(ccv))) {
    throw new Error("Revise os dados do cartão e tente novamente.");
  }
  if (intent.method === "cartao" && (!Number.isInteger(installments) || installments < 1 || installments > 6)) {
    throw new Error("Escolha de 1 a 6 parcelas.");
  }
  if (Number(intent.amount) < 5) {
    throw new Error("O valor mínimo para pagamento é R$ 5,00.");
  }
  const cardPayload = intent.method === "cartao" ? {
    creditCard: { holderName: String(card?.holderName ?? "").trim(), number: cardNumber, expiryMonth, expiryYear, ccv },
    creditCardHolderInfo: {
      name: String(card?.holderName ?? "").trim(), email: String(order.customer_email), cpfCnpj: digits(order.customer_document),
      postalCode: asaasPostalCode(order.shipping_zip), addressNumber: String(order.shipping_number), phone: asaasMobilePhone(order.customer_phone), mobilePhone: asaasMobilePhone(order.customer_phone),
    },
    remoteIp,
  } : {};
  const isInstallment = intent.method === "cartao" && installments > 1;
  const payment = await request(c, isInstallment ? "/installments" : "/payments", { method: "POST", body: JSON.stringify({
    customer,
    billingType: method(intent.method),
    value: isInstallment ? Number((Number(intent.amount) / installments).toFixed(2)) : Number(intent.amount),
    dueDate: todayPlus(intent.method === "boleto" ? boletoDueDays : 1),
    description: `Pedido Norte Sul #${String(order.id).slice(0,8)}`,
    ...(isInstallment ? { installmentCount: installments, totalValue: Number(intent.amount), paymentExternalReference: intent.id } : { externalReference: intent.id }),
    ...cardPayload,
  }) }, intent.method === "cartao" ? 65_000 : 30_000);
  if (!payment?.id) throw new Error("Não foi possível gerar a cobrança.");
  let pix: any = null;
  if (intent.method === "pix") pix = await request(c, `/payments/${encodeURIComponent(payment.id)}/pixQrCode`, { method: "GET", headers: { "Content-Type": "" } });
  const updated = await admin.from("payment_intents").update({ status: isInstallment ? "pending" : (normalize(payment.status) ?? "pending"), external_id: String(payment.id), checkout_url: payment.invoiceUrl ? String(payment.invoiceUrl) : null, boleto_url: payment.bankSlipUrl ?? null, boleto_barcode: payment.identificationField ?? null, pix_copy_paste: pix?.payload ?? null, pix_qr_code_url: pix?.encodedImage ? `data:image/png;base64,${pix.encodedImage}` : null, expires_at: pix?.expirationDate ?? null, provider_metadata: { ...(intent.provider_metadata ?? {}), asaas_payment_id: payment.id, asaas_customer_id: customer, asaas_environment: c.environment, boleto_due_days: intent.method === "boleto" ? boletoDueDays : undefined, installment_count: isInstallment ? installments : undefined }, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", intent.id).select("*").single();
  if (updated.error) throw new Error(updated.error.message); return updated.data;
}

function normalize(status: unknown): string | null { switch (String(status ?? "").toUpperCase()) { case "PENDING": case "AWAITING_RISK_ANALYSIS": return "pending"; case "RECEIVED": case "CONFIRMED": return "paid"; case "OVERDUE": return "expired"; case "REFUNDED": return "refunded"; case "REFUND_REQUESTED": return "partially_refunded"; case "DELETED": case "CANCELED": return "cancelled"; default: return null; } }
async function hash(value: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2,"0")).join(""); }

export async function processAsaasWebhook(admin: AdminClient, rawBody: string, headers: Headers) {
  const payload = JSON.parse(rawBody); const paymentId = String(payload?.payment?.id ?? "");
  if (!paymentId) return { ignored: true, reason: "missing_payment" };
  let { data: intent, error } = await admin.from("payment_intents").select("id,tenant_id,provider_id,amount,provider_metadata").eq("external_id", paymentId).maybeSingle();
  if (error) throw new Error(error.message);
  // Parcelamentos geram várias cobranças: cada uma chega pelo webhook com seu
  // próprio id, mas preserva a referência interna do pedido.
  if (!intent && payload?.payment?.externalReference) {
    const fallback = await admin.from("payment_intents").select("id,tenant_id,provider_id,amount,provider_metadata").eq("id", String(payload.payment.externalReference)).maybeSingle();
    if (fallback.error) throw new Error(fallback.error.message);
    intent = fallback.data;
  }
  if (!intent) return { ignored: true, reason: "unknown_payment" };
  const c = await context(admin, intent.tenant_id);
  const receivedToken = headers.get("asaas-access-token") ?? "";
  if (!c.webhookToken || receivedToken.length !== c.webhookToken.length || !timingSafeEqual(Buffer.from(receivedToken), Buffer.from(c.webhookToken))) throw new Error("Webhook Asaas não autenticado.");
  if (intent.provider_id !== c.providerId) throw new Error("Webhook não pertence ao Asaas ativo.");
  const remote = await request(c, `/payments/${encodeURIComponent(paymentId)}`, { method: "GET", headers: { "Content-Type": "" } });
  if (String(remote?.externalReference) !== intent.id) throw new Error("Correlação Asaas inválida.");
  const installmentCount = Number(intent.provider_metadata?.installment_count ?? 1);
  const expectedValue = installmentCount > 1 ? Number(intent.amount) / installmentCount : Number(intent.amount);
  if (Math.abs(Number(remote?.value) - expectedValue) > 0.02) throw new Error("Valor Asaas diverge do pedido.");
  const status = normalize(remote?.status); if (!status) return { ignored: true, reason: "unsupported_status" };
  const eventId = String(payload?.id ?? `${payload?.event}:${paymentId}:${remote?.status}:${remote?.confirmedDate ?? remote?.paymentDate ?? ""}`);
  const { error: updateError } = await admin.from("payment_intents").update({ provider_metadata: { asaas_payment_id: paymentId, asaas_last_event: payload?.event ?? null, asaas_status: remote?.status ?? null }, updated_at: new Date().toISOString() }).eq("id", intent.id).eq("tenant_id", intent.tenant_id);
  if (updateError) throw new Error(updateError.message);
  const { data, error: applyError } = await admin.rpc("internal_apply_payment_webhook", { p_provider_id: c.providerId, p_provider_event_id: eventId.slice(0,255), p_event_type: String(payload?.event ?? "PAYMENT_UPDATED").slice(0,120), p_external_payment_id: paymentId, p_normalized_status: status, p_payload_sha256: await hash(rawBody), p_signature_verified: true });
  if (applyError) throw new Error(applyError.message); return { ignored: false, normalizedStatus: status, result: data };
}
