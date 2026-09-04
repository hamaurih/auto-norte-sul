import { decryptIntegrationSecret } from "@/lib/integration-crypto.server";

const MP_API = "https://api.mercadopago.com";
const SITE_URL = "https://www.nortesulauto.com.br";

type AdminClient = any;

async function integrationId(admin: AdminClient) {
  const { data, error } = await admin.from("integrations").select("id").eq("slug", "mercado-pago").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Integração Mercado Pago não cadastrada.");
  return data.id as string;
}

export async function getMercadoPagoAccessToken(admin: AdminClient, tenantId: string) {
  const id = await integrationId(admin);
  const [{ data: state, error: stateError }, { data: setting, error: settingError }] = await Promise.all([
    admin.from("tenant_integration_states")
      .select("status,active")
      .eq("tenant_id", tenantId)
      .eq("integration_id", id)
      .maybeSingle(),
    admin.from("integration_settings")
      .select("value_encrypted,is_secret")
      .eq("tenant_id", tenantId)
      .eq("integration_id", id)
      .eq("key", "access_token")
      .maybeSingle(),
  ]);
  if (stateError) throw new Error(stateError.message);
  if (settingError) throw new Error(settingError.message);
  if (!setting?.value_encrypted || !setting.is_secret) throw new Error("Access Token do Mercado Pago não configurado.");
  const token = await decryptIntegrationSecret(setting.value_encrypted);
  if (!token) throw new Error("Access Token do Mercado Pago inválido.");
  return { token, integrationId: id, connected: state?.status === "connected" && Boolean(state?.active) };
}

async function mpFetch(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!response.ok) {
    const message = String(body?.message ?? body?.error ?? `Mercado Pago respondeu ${response.status}`).slice(0, 500);
    throw new Error(message);
  }
  return body;
}

export async function validateMercadoPagoConnection(admin: AdminClient, tenantId: string) {
  const { token } = await getMercadoPagoAccessToken(admin, tenantId);
  const account = await mpFetch(token, "/users/me", { method: "GET" });
  if (!account?.id) throw new Error("Mercado Pago não confirmou a conta vinculada.");
  return { accountId: String(account.id), siteId: account.site_id ? String(account.site_id) : null };
}

export async function activateMercadoPagoProvider(admin: AdminClient, tenantId: string) {
  const { data, error } = await admin.from("payment_providers")
    .update({ active: true, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("code", "mercado_pago")
    .eq("environment", "production")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Provider Mercado Pago não preparado neste ambiente.");
  return data.id as string;
}

export async function createMercadoPagoPreference(admin: AdminClient, tenantId: string, intentId: string) {
  const { token, connected } = await getMercadoPagoAccessToken(admin, tenantId);
  if (!connected) throw new Error("Mercado Pago ainda não foi validado em Integrações.");

  const { data: intent, error: intentError } = await admin.from("payment_intents")
    .select("id,order_id,provider_id,amount,currency,status,idempotency_key,external_id,checkout_url")
    .eq("tenant_id", tenantId)
    .eq("id", intentId)
    .maybeSingle();
  if (intentError) throw new Error(intentError.message);
  if (!intent) throw new Error("Intenção de pagamento não encontrada.");
  if (intent.checkout_url && intent.external_id) return intent;
  if (!["created", "pending"].includes(String(intent.status))) throw new Error("Intenção de pagamento não pode gerar checkout neste estado.");

  const [{ data: order, error: orderError }, { data: items, error: itemsError }] = await Promise.all([
    admin.from("orders")
      .select("id,total,customer_name,customer_email,customer_document,payment_method")
      .eq("tenant_id", tenantId)
      .eq("id", intent.order_id)
      .maybeSingle(),
    admin.from("order_items")
      .select("product_id,sku,name,quantity,unit_price,total")
      .eq("tenant_id", tenantId)
      .eq("order_id", intent.order_id)
      .order("id"),
  ]);
  if (orderError) throw new Error(orderError.message);
  if (itemsError) throw new Error(itemsError.message);
  if (!order || !items?.length) throw new Error("Pedido sem itens para pagamento.");

  const itemTotal = items.reduce((sum: number, item: any) => sum + Number(item.total ?? Number(item.unit_price) * Number(item.quantity)), 0);
  const orderTotal = Number(order.total);
  const adjustment = Number((orderTotal - itemTotal).toFixed(2));
  const preferenceItems = items.map((item: any) => ({
    id: String(item.product_id ?? item.sku ?? item.name).slice(0, 256),
    title: String(item.name).slice(0, 256),
    quantity: Number(item.quantity),
    unit_price: Number(item.unit_price),
    currency_id: "BRL",
  }));
  if (Math.abs(adjustment) >= 0.01) {
    preferenceItems.push({
      id: "order-adjustment",
      title: adjustment > 0 ? "Frete e ajustes" : "Desconto do pedido",
      quantity: 1,
      unit_price: adjustment,
      currency_id: "BRL",
    });
  }

  const document = String(order.customer_document ?? "").replace(/\D/g, "");
  const payer: any = { email: String(order.customer_email ?? "").trim() };
  if (document.length === 11) payer.identification = { type: "CPF", number: document };
  else if (document.length === 14) payer.identification = { type: "CNPJ", number: document };

  const preference = await mpFetch(token, "/checkout/preferences", {
    method: "POST",
    headers: { "X-Idempotency-Key": String(intent.idempotency_key) },
    body: JSON.stringify({
      items: preferenceItems,
      payer,
      external_reference: intent.id,
      statement_descriptor: "NORTE SUL",
      notification_url: `${SITE_URL}/api/public/payments/mercado-pago/webhook`,
      back_urls: {
        success: `${SITE_URL}/pedidos`,
        pending: `${SITE_URL}/pedidos`,
        failure: `${SITE_URL}/checkout`,
      },
      auto_return: "approved",
      metadata: { tenant_id: tenantId, order_id: order.id, payment_intent_id: intent.id },
      payment_methods: { installments: 10 },
    }),
  });

  const checkoutUrl = String(preference?.init_point ?? "");
  if (!preference?.id || !/^https:\/\//.test(checkoutUrl)) throw new Error("Mercado Pago não retornou URL de checkout.");

  const { data: updated, error: updateError } = await admin.from("payment_intents")
    .update({
      status: "pending",
      external_id: String(preference.id),
      checkout_url: checkoutUrl,
      provider_metadata: {
        preference_id: String(preference.id),
        sandbox_init_point: preference.sandbox_init_point ?? null,
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

export function normalizeMercadoPagoStatus(status: string) {
  const value = status.toLowerCase();
  if (value === "approved") return "paid";
  if (value === "authorized") return "authorized";
  if (value === "pending" || value === "in_process" || value === "in_mediation") return "pending";
  if (value === "rejected") return "failed";
  if (value === "cancelled") return "cancelled";
  if (value === "refunded") return "refunded";
  if (value === "charged_back") return "refunded";
  return "pending";
}

export async function fetchMercadoPagoPayment(token: string, paymentId: string) {
  if (!/^\d+$/.test(paymentId)) throw new Error("ID de pagamento inválido.");
  return mpFetch(token, `/v1/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
}
