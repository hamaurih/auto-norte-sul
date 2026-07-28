export type PaymentMethod = "pix" | "cartao" | "boleto" | "faturado_b2b";

export type PaymentStatus =
  | "created"
  | "pending"
  | "requires_action"
  | "authorized"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "partially_refunded"
  | "refunded";

export type CreatePaymentRequest = {
  intentId: string;
  orderId: string;
  amount: number;
  currency: "BRL";
  method: PaymentMethod;
  idempotencyKey: string;
  customer: {
    name: string;
    email: string;
    document?: string;
  };
};

export type ProviderPayment = {
  externalId: string;
  status: PaymentStatus;
  checkoutUrl?: string;
  pixCopyPaste?: string;
  pixQrCodeUrl?: string;
  boletoUrl?: string;
  boletoBarcode?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
};

export type VerifiedWebhook = {
  providerEventId: string;
  eventType: string;
  externalPaymentId?: string;
  status?: PaymentStatus;
  payloadSha256: string;
};

export interface PaymentProviderAdapter {
  readonly key: string;
  createPayment(request: CreatePaymentRequest): Promise<ProviderPayment>;
  getPayment(externalId: string): Promise<ProviderPayment>;
  refund(
    externalId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<{ externalId: string; status: "processing" | "succeeded" }>;
  verifyWebhook(
    rawBody: string,
    headers: Headers,
    webhookSecret: string,
  ): Promise<VerifiedWebhook>;
}
