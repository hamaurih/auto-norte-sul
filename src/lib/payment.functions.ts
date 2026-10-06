import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";

type CreatePaymentIntentInput = {
  orderId: string;
  idempotencyKey: string;
  providerCode?: string;
  boletoDueDays?: 15 | 30 | 45 | 60 | 90 | 120;
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
    const { ensureAsaasProviderReady, createAsaasPayment } = await import(
      "@/lib/asaas-payments.server"
    );

    const asaas = await ensureAsaasProviderReady(supabaseAdmin as any, context.tenantId);

    const { data: order, error: orderError } = await (supabaseAdmin as any)
      .from("orders")
      .select("id,payment_method,status,user_id,is_b2b,customer_document")
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
    const boletoDueDays = data.boletoDueDays ?? 15;
    const installments = data.installments ?? 1;
    if (!Number.isInteger(installments) || installments < 1 || installments > 6) {
      throw new Error("Escolha de 1 a 6 parcelas para o cartão.");
    }
    if (order.payment_method === "boleto") {
    if (!order.is_b2b || !/^(?:\d{11}|\d{14})$/.test(String(order.customer_document ?? "").replace(/\D/g, ""))) {
        throw new Error("Boleto Asaas é exclusivo para cliente B2B aprovado com CPF ou CNPJ válido.");
      }
      if (![15, 30, 45, 60, 90, 120].includes(boletoDueDays)) {
        throw new Error("Prazo de boleto inválido. Escolha 15, 30, 45, 60, 90 ou 120 dias.");
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
