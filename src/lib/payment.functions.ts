import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";

type CreatePaymentIntentInput = {
  orderId: string;
  idempotencyKey: string;
  providerCode?: string;
  boletoDueDays?: 3 | 15 | 30 | 45 | 60 | 90 | 120;
  installments?: 1 | 2 | 3 | 4 | 5 | 6;
  card?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
};

export const createPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreatePaymentIntentInput) => input)
  .handler(async ({ data, context }) => {
    const providerCode = data.providerCode ?? "asaas";
    if (providerCode !== "asaas") {
      throw new Error("Asaas é o provider transacional principal deste ambiente.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getAsaasPaymentContext, createAsaasPayment } = await import(
      "@/lib/asaas-payments.server"
    );

    // A validação administrativa da conta não deve bloquear cada compra.
    const asaas = await getAsaasPaymentContext(supabaseAdmin as any, context.tenantId);

    const { data: order, error: orderError } = await (supabaseAdmin as any)
      .from("orders")
      .select("id,payment_method,status,user_id,is_b2b,customer_id,customer_document,payment_due_days")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.orderId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) throw new Error("Pedido não encontrado.");
    if (order.user_id !== context.userId) {
      const { data: membership } = await (supabaseAdmin as any)
        .from("tenant_memberships")
        .select("role")
        .eq("tenant_id", context.tenantId)
        .eq("user_id", context.userId)
        .eq("active", true)
        .maybeSingle();
      if (!membership || !["owner", "admin", "manager", "finance", "sales"].includes(membership.role)) {
        throw new Error("Sem permissão para cobrar este pedido.");
      }
    }
    if (order.status !== "aguardando_pagamento") {
      throw new Error("Pedido não está aguardando pagamento.");
    }
    if (!["pix", "cartao", "boleto"].includes(String(order.payment_method))) {
      throw new Error("O Asaas está habilitado neste checkout apenas para PIX, cartão e boleto.");
    }
    let allowedBoletoDays = order.is_b2b ? [15] : [3];
    let maxCardInstallments = 6;
    if (order.is_b2b && order.customer_id) {
      const { data: terms, error: termsError } = await (supabaseAdmin as any)
        .from("b2b_customer_price_tables")
        .select("allowed_boleto_days,max_card_installments,active")
        .eq("tenant_id", context.tenantId)
        .eq("customer_id", order.customer_id)
        .eq("active", true)
        .maybeSingle();
      if (termsError) throw new Error(termsError.message);
      allowedBoletoDays = terms?.allowed_boleto_days ?? [15];
      maxCardInstallments = Number(terms?.max_card_installments ?? 6);
    }

    const boletoDueDays = data.boletoDueDays ?? Number(order.payment_due_days ?? allowedBoletoDays[0] ?? 3);
    const installments = data.installments ?? 1;
    if (!Number.isInteger(installments) || installments < 1 || installments > maxCardInstallments) {
      throw new Error(`Este cadastro permite cartão em até ${maxCardInstallments}x.`);
    }
    if (order.payment_method === "boleto") {
      if (!/^(?:\d{11}|\d{14})$/.test(String(order.customer_document ?? "").replace(/\D/g, ""))) {
        throw new Error("Informe CPF ou CNPJ válido para gerar o boleto.");
      }
      if (!allowedBoletoDays.includes(boletoDueDays)) {
        throw new Error(order.is_b2b
          ? "Este prazo de boleto não está liberado para seu cadastro B2B."
          : "Para cliente B2C, o boleto vence em até 3 dias.");
      }
    }

    let intent: any = null;
    const { data: existing, error: existingError } = await (supabaseAdmin as any)
      .from("payment_intents")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("order_id", data.orderId)
      .eq("provider_id", asaas.providerId)
      .in("status", ["created", "pending", "requires_action"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    intent = existing;

    if (!intent) {
      const { data: created, error } = await (supabaseAdmin as any).rpc(
        "internal_create_payment_intent",
        {
          p_order_id: data.orderId,
          p_actor_user_id: context.userId,
          p_idempotency_key: data.idempotencyKey,
          p_provider_code: "asaas",
        },
      );
      if (error) throw new Error(error.message);
      if (!created?.id) throw new Error("Intenção de pagamento não retornada");
      intent = created;
    }

    const ready = await createAsaasPayment(
      supabaseAdmin as any,
      context.tenantId,
      intent.id as string,
      boletoDueDays,
      data.card,
      getRequestIP({ xForwardedFor: true }) ?? undefined,
      installments,
      asaas,
    );

    return {
      id: ready.id as string,
      providerId: ready.provider_id as string,
      status: ready.status as string,
      method: ready.method as string,
      amount: Number(ready.amount),
      checkoutUrl: ready.checkout_url as string | null,
      pixCopyPaste: ready.pix_copy_paste as string | null,
      pixQrCodeUrl: ready.pix_qr_code_url as string | null,
      boletoUrl: ready.boleto_url as string | null,
      boletoBarcode: ready.boleto_barcode as string | null,
      expiresAt: ready.expires_at as string | null,
    };
  });
