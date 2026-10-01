import { decryptIntegrationSecret } from "@/lib/integration-crypto.server";

const PROD_API = "https://api.pagar.me/core/v5";
const SANDBOX_API = "https://sdx-api.pagar.me/core/v5";
const SITE_URL = "https://www.nortesulauto.com.br";

type AdminClient = any;
type StoneEnvironment = "production" | "sandbox";

type StoneTransactionContext = {
  integrationId: string;
  providerId: string;
  secretKey: string;
  environment: StoneEnvironment;
  baseUrl: string;
};

function basicAuth(secretKey: string) {
  return `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`;
}

async function integrationId(admin: AdminClient) {
  const { data, error } = await admin
    .from("integrations")
    .select("id")
    .eq("slug", "stone")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Integração Stone não cadastrada.");
  return data.id as string;
}

async function readSecretSetting(admin: AdminClient, tenantId: string, id: string, key: string) {
  const { data, error } = await admin
    .from("integration_settings")
    .select("value_encrypted,is_secret")
    .eq("tenant_id", tenantId)
    .eq("integration_id", id)
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.value_encrypted) return "";
  return data.is_secret
    ? await decryptIntegrationSecret(data.value_encrypted)
    : String(data.value_encrypted);
}

async function getStoneTransactionContext(admin: AdminClient, tenantId: string): Promise<StoneTransactionContext> {
  const id = await integrationId(admin);
  const secretKey = (await readSecretSetting(admin, tenantId, id, "transaction_secret_key")).trim();
  if (!secretKey) {
    throw new Error(
      "Chave transacional Stone/Pagar.me não configurada. Cadastre a Secret Key da conta Stone antes de cobrar.",
    );
  }

  const environment: StoneEnvironment = secretKey.startsWith("sk_test_") ? "sandbox" : "production";
  if (environment === "production" && !secretKey.startsWith("sk_")) {
    throw new Error("Secret Key Stone/Pagar.me em formato inválido.");
  }

  const { data: provider, error: providerError } = await admin
    .from("payment_providers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("code", "stone")
    .eq("environment", environment)
    .maybeSingle();
  if (providerError) throw new Error(providerError.message);
  if (!provider?.id) throw new Error(`Provider Stone ${environment} não preparado no ERP.`);

  return {
    integrationId: id,
    providerId: provider.id as string,
    secretKey,
    environment,
    baseUrl: environment === "sandbox" ? SANDBOX_API : PROD_API,
  };
}

async function stoneFetch(context: StoneTransactionContext, path: string, init: RequestInit = {}) {
  const response = await fetch(`${context.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: basicAuth(context.secretKey),
      "User-Agent": "NorteSulERP/1.0",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });

  const raw = await response.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw ? { message: raw } : null;
  }
  if (!response.ok) {
    const detail = String(body?.message ?? body?.error ?? `HTTP ${response.status}`).slice(0, 500);
    throw new Error(`Stone/Pagar.me respondeu ${response.status}: ${detail}`);
  }
  return body;
}

export async function ensureStoneProviderReady(admin: AdminClient, tenantId: string) {
  const context = await getStoneTransactionContext(admin, tenantId);

  // Read-only request: validates the key without creating a financial transaction.
  await stoneFetch(context, "/orders?page=1&size=1", { method: "GET" });

  const now = new Date().toISOString();
  const { error: deactivateError } = await admin
    .from("payment_providers")
    .update({ active: false, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("code", "stone")
    .neq("id", context.providerId);
  if (deactivateError) throw new Error(deactivateError.message);

  const { error: activateError } = await admin
    .from("payment_providers")
    .update({
      active: true,
      priority: 10,
      adapter_key: "stone-pagarme-v5",
      supported_methods: ["pix", "cartao", "boleto"],
      capabilities: {
        checkout: true,
        hosted_checkout: true,
        pix: true,
        credit_card: true,
        boleto: true,
        webhook: true,
        reconciliation: true,
        pix_reconciliation: true,
        pci_card_data_on_erp: false,
      },
      updated_at: now,
    })
    .eq("id", context.providerId)
    .eq("tenant_id", tenantId);
  if (activateError) throw new Error(activateError.message);

  await admin
    .from("tenant_integration_states")
    .update({ status: "connected", active: true, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("integration_id", context.integrationId);

  return context;
}

function paymentSettings(method: string, amountCents: number) {
  if (method === "pix") {
    return {
      accepted_payment_methods: ["pix"],
      pix_settings: { expires_in: 1800 },
    };
  }
  if (method === "cartao") {
    return {
      accepted_payment_methods: ["credit_card"],
      credit_card_settings: {
        operation_type: "auth_and_capture",
        installments_setup: { interest_type: "simple" },
        installments: Array.from({ length: 6 }, (_, index) => ({
          number: index + 1,
          total: amountCents,
        })),
      },
    };
  }
  if (method === "boleto") {
    // O checkout hospedado da Stone/Pagar.me exibe o boleto e gera a linha
    // digitável conforme as regras de vencimento configuradas no dashboard.
    return { accepted_payment_methods: ["boleto"] };
  }
  throw new Error("A Stone está habilitada neste fluxo apenas para PIX, cartão e boleto.");
}

export async function createStonePaymentLink(
  admin: AdminClient,
  tenantId: string,
  intentId: string,
  boletoDueDays = 15,
) {
  const context = await getStoneTransactionContext(admin, tenantId);
  const { data: intent, error: intentError } = await admin
    .from("payment_intents")
    .select("id,order_id,provider_id,method,amount,status,idempotency_key,external_id,checkout_url,provider_metadata")
    .eq("tenant_id", tenantId)
    .eq("id", intentId)
    .maybeSingle();
  if (intentError) throw new Error(intentError.message);
  if (!intent) throw new Error("Intenção de pagamento não encontrada.");
  if (intent.provider_id !== context.providerId) throw new Error("Provider da intenção não corresponde à Stone ativa.");
  if (intent.checkout_url && intent.external_id) return intent;
  if (!["created", "pending", "requires_action"].includes(String(intent.status))) {
    throw new Error("Esta intenção não pode gerar um novo checkout.");
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,total,customer_name,customer_email,customer_phone,customer_document,shipping_zip,shipping_street,shipping_number,shipping_complement,shipping_neighborhood,shipping_city,shipping_state,is_b2b,status")
    .eq("tenant_id", tenantId)
    .eq("id", intent.order_id)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!order) throw new Error("Pedido não encontrado para a cobrança Stone.");
  if (order.status !== "aguardando_pagamento") throw new Error("Pedido não está aguardando pagamento.");

  const amountCents = Math.round(Number(intent.amount) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 100) {
    throw new Error("Valor inválido para cobrança Stone.");
  }

  if (intent.method === "boleto") {
    const document = String(order.customer_document ?? "").replace(/\D/g, "");
    if (!order.is_b2b || !/^(?:\d{11}|\d{14})$/.test(document)) {
      throw new Error("Boleto Stone é exclusivo para cliente B2B aprovado com CPF ou CNPJ válido.");
    }
    if (![15, 30, 45, 60, 90, 120].includes(boletoDueDays)) {
      throw new Error("Prazo de boleto Stone inválido.");
    }
    const isCompany = document.length === 14;
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + boletoDueDays);
    dueAt.setHours(12, 0, 0, 0);
    const remoteOrder = await stoneFetch(context, "/orders", {
      method: "POST",
      headers: { "Idempotency-Key": String(intent.idempotency_key) },
      body: JSON.stringify({
        code: intent.id,
        items: [{ amount: amountCents, description: `Pedido Norte Sul #${String(order.id).slice(0, 8)}`, quantity: 1 }],
        customer: {
          name: String(order.customer_name ?? "Cliente B2B"),
          email: String(order.customer_email ?? "financeiro@nortesulauto.com.br"),
          document,
          document_type: isCompany ? "CNPJ" : "CPF",
          type: isCompany ? "company" : "individual",
          address: {
            line_1: `${String(order.shipping_street ?? "").trim()}, ${String(order.shipping_number ?? "").trim()}`.trim(),
            line_2: [order.shipping_complement, order.shipping_neighborhood].filter(Boolean).join(" · ") || undefined,
            zip_code: String(order.shipping_zip ?? "").replace(/\D/g, ""),
            city: String(order.shipping_city ?? ""),
            state: String(order.shipping_state ?? "").toUpperCase(),
            country: "BR",
          },
        },
        payments: [{
          payment_method: "boleto",
          boleto: {
            due_at: dueAt.toISOString(),
            instructions: `Boleto Norte Sul · prazo negociado de ${boletoDueDays} dias.`,
            document_number: String(intent.id).replace(/-/g, "").slice(0, 16),
            type: "DM",
          },
        }],
      }),
    });
    const charge = Array.isArray(remoteOrder?.charges) ? remoteOrder.charges[0] : null;
    const transaction = charge?.last_transaction ?? remoteOrder?.last_transaction ?? {};
    const boletoUrl = String(transaction?.url ?? "");
    const barcode = String(transaction?.line ?? "");
    const externalId = String(charge?.id ?? remoteOrder?.id ?? "");
    if (!externalId || !/^https:\/\//i.test(boletoUrl)) {
      throw new Error("Stone não retornou um boleto registrado válido.");
    }
    const { data: updated, error: updateError } = await admin
      .from("payment_intents")
      .update({
        status: "pending", external_id: externalId, checkout_url: boletoUrl, boleto_url: boletoUrl,
        boleto_barcode: barcode || null, expires_at: dueAt.toISOString(),
        provider_metadata: { ...(intent.provider_metadata ?? {}), stone_order_id: remoteOrder?.id ?? null, stone_charge_id: charge?.id ?? null, boleto_due_days: boletoDueDays, boleto_due_at: dueAt.toISOString(), checkout: "stone_pagarme_v5_registered_boleto" },
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId).eq("id", intent.id).select("*").single();
    if (updateError) throw new Error(updateError.message);
    return updated;
  }

  const link = await stoneFetch(context, "/paymentlinks", {
    method: "POST",
    headers: { "Idempotency-Key": String(intent.idempotency_key) },
    body: JSON.stringify({
      type: "order",
      name: `Norte Sul #${String(order.id).slice(0, 8)}`,
      order_code: intent.id,
      is_building: false,
      expires_in: 30,
      max_sessions: 1,
      max_paid_sessions: 1,
      payment_settings: paymentSettings(String(intent.method), amountCents),
      cart_settings: {
        items: [
          {
            amount: amountCents,
            name: `Pedido Norte Sul #${String(order.id).slice(0, 8)}`,
            default_quantity: 1,
          },
        ],
      },
      layout_settings: {
        image_url: `${SITE_URL}/favicon.ico`,
      },
    }),
  });

  const checkoutUrl = String(link?.url ?? "");
  const linkId = String(link?.id ?? "");
  if (!linkId || !/^https:\/\//i.test(checkoutUrl)) {
    throw new Error("Stone/Pagar.me não retornou um link de checkout válido.");
  }

  const { data: updated, error: updateError } = await admin
    .from("payment_intents")
    .update({
      status: "pending",
      external_id: linkId,
      checkout_url: checkoutUrl,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      provider_metadata: {
        ...(intent.provider_metadata ?? {}),
        stone_payment_link_id: linkId,
        stone_environment: context.environment,
        checkout: "pagarme_v5_paymentlink",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", intent.id)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);
  return updated;
}

function uuid(value: unknown): string | null {
  const text = typeof value === "string" ? value : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function normalizeStatus(status: unknown): string | null {
  switch (String(status ?? "").toLowerCase()) {
    case "paid": return "paid";
    case "pending":
    case "processing": return "pending";
    case "failed": return "failed";
    case "canceled":
    case "cancelled": return "cancelled";
    case "refunded":
    case "chargedback": return "refunded";
    default: return null;
  }
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function processStonePaymentWebhook(admin: AdminClient, payload: any) {
  const eventType = String(payload?.type ?? "");
  const data = payload?.data ?? {};
  const embeddedOrder = data?.order ?? {};
  const intentId = uuid(embeddedOrder?.code ?? data?.code ?? data?.order_code ?? data?.metadata?.payment_intent_id);
  if (!intentId) return { accepted: true, ignored: true, reason: "missing_order_code" };

  const { data: intent, error: intentError } = await admin
    .from("payment_intents")
    .select("id,tenant_id,provider_id,amount,status")
    .eq("id", intentId)
    .maybeSingle();
  if (intentError) throw new Error(intentError.message);
  if (!intent) return { accepted: true, ignored: true, reason: "unknown_intent" };

  const context = await getStoneTransactionContext(admin, intent.tenant_id);
  if (context.providerId !== intent.provider_id) throw new Error("Webhook não pertence ao provider Stone do tenant.");

  let remote: any = null;
  let charge: any = null;
  if (eventType.startsWith("charge.") && typeof data?.id === "string") {
    remote = await stoneFetch(context, `/charges/${encodeURIComponent(data.id)}`, { method: "GET" });
    charge = remote;
    if (uuid(remote?.order?.code) !== intentId) throw new Error("Correlação Stone inválida.");
  } else if (eventType.startsWith("order.") && typeof data?.id === "string") {
    remote = await stoneFetch(context, `/orders/${encodeURIComponent(data.id)}`, { method: "GET" });
    if (uuid(remote?.code) !== intentId) throw new Error("Correlação Stone inválida.");
    charge = Array.isArray(remote?.charges) ? remote.charges[0] : null;
  } else if (eventType === "chargeback.received") {
    const chargeId = data?.charge?.id ?? data?.charge_id;
    if (typeof chargeId !== "string") return { accepted: true, ignored: true, reason: "chargeback_without_charge" };
    charge = await stoneFetch(context, `/charges/${encodeURIComponent(chargeId)}`, { method: "GET" });
    if (uuid(charge?.order?.code) !== intentId) throw new Error("Correlação Stone inválida.");
  } else {
    return { accepted: true, ignored: true, reason: "unsupported_event" };
  }

  if (!charge?.id) return { accepted: true, ignored: true, reason: "charge_not_available" };
  const normalized = eventType === "chargeback.received" ? "refunded" : normalizeStatus(charge.status ?? remote?.status);
  if (!normalized) return { accepted: true, ignored: true, reason: "unsupported_status" };

  const remoteAmount = Number(charge.amount ?? remote?.amount ?? 0);
  const expectedAmount = Math.round(Number(intent.amount) * 100);
  if (Number.isFinite(remoteAmount) && remoteAmount > 0 && remoteAmount !== expectedAmount) {
    throw new Error("Valor do pagamento Stone diverge do pedido.");
  }

  const { error: externalError } = await admin
    .from("payment_intents")
    .update({
      external_id: String(charge.id),
      provider_metadata: {
        stone_charge_id: String(charge.id),
        stone_order_id: String(charge?.order?.id ?? remote?.id ?? ""),
        stone_last_event: eventType,
        stone_status: String(charge.status ?? remote?.status ?? ""),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", intent.tenant_id)
    .eq("id", intent.id);
  if (externalError) throw new Error(externalError.message);

  const eventId = String(payload?.id ?? `${eventType}:${charge.id}:${charge.status ?? normalized}`);
  const payloadHash = await sha256(JSON.stringify(payload));
  const { data: result, error: applyError } = await admin.rpc("internal_apply_payment_webhook", {
    p_provider_id: intent.provider_id,
    p_provider_event_id: eventId.slice(0, 255),
    p_event_type: eventType.slice(0, 120),
    p_external_payment_id: String(charge.id),
    p_normalized_status: normalized,
    p_payload_sha256: payloadHash,
    p_signature_verified: true,
  });
  if (applyError) throw new Error(applyError.message);

  return { accepted: true, ignored: false, result, normalizedStatus: normalized };
}
