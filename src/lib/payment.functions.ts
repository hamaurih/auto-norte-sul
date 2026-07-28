import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CreatePaymentIntentInput = {
  orderId: string;
  idempotencyKey: string;
  providerCode?: string;
};

export const createPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreatePaymentIntentInput) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: intent, error } = await (supabaseAdmin as any).rpc(
      "internal_create_payment_intent",
      {
        p_order_id: data.orderId,
        p_actor_user_id: context.userId,
        p_idempotency_key: data.idempotencyKey,
        p_provider_code: data.providerCode ?? null,
      },
    );

    if (error) throw new Error(error.message);
    if (!intent?.id) throw new Error("Intenção de pagamento não retornada");

    return {
      id: intent.id as string,
      providerId: intent.provider_id as string,
      status: intent.status as string,
      method: intent.method as string,
      amount: Number(intent.amount),
      checkoutUrl: intent.checkout_url as string | null,
      pixCopyPaste: intent.pix_copy_paste as string | null,
      pixQrCodeUrl: intent.pix_qr_code_url as string | null,
      boletoUrl: intent.boleto_url as string | null,
      boletoBarcode: intent.boleto_barcode as string | null,
      expiresAt: intent.expires_at as string | null,
    };
  });
