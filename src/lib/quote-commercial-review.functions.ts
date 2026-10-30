import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTenantRole } from "@/lib/auth-guards";

export type QuoteReviewStatus = "pending" | "offered" | "denied" | "converted";
export type QuoteReviewBenefit = "conditions" | "discount" | "credit";

const requestSchema = z.object({
  quoteId: z.string().uuid(),
  benefit: z.enum(["conditions", "discount", "credit"]).default("conditions"),
  message: z.string().trim().max(500).default(""),
});

const decisionSchema = z.object({
  reviewId: z.string().uuid(),
  decision: z.enum(["offer", "deny"]),
  additionalDiscount: z.number().finite().min(0).max(1000000).default(0),
  creditMode: z.enum(["none", "invoice"]).default("none"),
  managerNote: z.string().trim().max(1000).default(""),
});

export const requestQuoteCommercialReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => requestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (supabaseAdmin as any)
      .rpc("internal_request_quote_commercial_review", {
        p_tenant_id: context.tenantId,
        p_user_id: context.userId,
        p_quote_id: data.quoteId,
        p_benefit: data.benefit,
        p_message: data.message,
      });
    if (error) {
      if (String(error.message).includes("QUOTE_EXPIRED")) {
        throw new Error("Orçamento vencido. Gere outro orçamento antes de solicitar análise.");
      }
      if (String(error.message).includes("QUOTE_NOT_OWNED_BY_USER")) {
        throw new Error("Este orçamento não pertence à sua conta.");
      }
      throw new Error(error.message);
    }
    return result as { ok: true; reused: boolean; id: string; status: QuoteReviewStatus };
  });

async function managerAccess(userId: string, tenantId: string) {
  await requireTenantRole(supabaseAdmin as any, userId, tenantId, ["owner", "admin", "manager"]);
}

export const listQuoteCommercialReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await managerAccess(context.userId, context.tenantId);
    const db = supabaseAdmin as any;
    const { data: reviews, error } = await db
      .from("quote_commercial_reviews")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("requested_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    if (!reviews?.length) return [];

    const quoteIds = [...new Set((reviews as any[]).map((review) => review.quote_id))];
    const customerIds = [...new Set((reviews as any[]).map((review) => review.customer_id))];

    const [quotesResponse, customersResponse, termsResponse] = await Promise.all([
      db.from("quotes")
        .select("id,number,customer_name,customer_email,customer_phone,origin,status,subtotal,discount,shipping_amount,total,valid_until,quote_items(id,product_id,name,sku,qty,unit_price,discount,total)")
        .eq("tenant_id", context.tenantId).in("id", quoteIds),
      db.from("customers")
        .select("id,customer_group,b2b_status,document")
        .eq("tenant_id", context.tenantId).in("id", customerIds),
      db.from("b2b_customer_price_tables")
        .select("customer_id,allow_invoice,invoice_due_days,active")
        .eq("tenant_id", context.tenantId)
        .in("customer_id", customerIds)
        .eq("active", true),
    ]);
    const firstError = quotesResponse.error ?? customersResponse.error ?? termsResponse.error;
    if (firstError) throw new Error(firstError.message);

    const quotes = new Map<string, any>((quotesResponse.data ?? []).map((v: any) => [v.id, v]));
    const customers = new Map<string, any>((customersResponse.data ?? []).map((v: any) => [v.id, v]));
    const terms = new Map<string, any>((termsResponse.data ?? []).map((v: any) => [v.customer_id, v]));

    return (reviews as any[]).map((review) => {
      const customer = customers.get(review.customer_id);
      const credit = terms.get(review.customer_id);
      return {
        ...review,
        quote: quotes.get(review.quote_id) ?? null,
        creditEligible: Boolean(
          ["revendedor", "oficina", "distribuidor"].includes(String(customer?.customer_group)) &&
          customer?.b2b_status === "approved" && credit?.allow_invoice,
        ),
        allowedCreditDays: credit?.allow_invoice ? Number(credit.invoice_due_days ?? 0) : null,
      };
    });
  });

export const decideQuoteCommercialReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => decisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    await managerAccess(context.userId, context.tenantId);
    const { data: result, error } = await (supabaseAdmin as any)
      .rpc("internal_decide_quote_commercial_review", {
        p_tenant_id: context.tenantId,
        p_manager_id: context.userId,
        p_review_id: data.reviewId,
        p_decision: data.decision,
        p_additional_discount: data.decision === "deny" ? 0 : data.additionalDiscount,
        p_credit_mode: data.decision === "deny" ? "none" : data.creditMode,
        p_manager_note: data.managerNote,
      });
    if (error) {
      const message = String(error.message ?? "");
      if (message.includes("CUSTOMER_CREDIT_NOT_APPROVED")) {
        throw new Error("Crédito faturado exige cliente B2B ativo com faturamento previamente habilitado.");
      }
      if (message.includes("REVIEW_ALREADY_DECIDED")) {
        throw new Error("Esta solicitação já foi analisada. Atualize a fila antes de prosseguir.");
      }
      if (message.includes("MINIMUM_CHECKOUT_AMOUNT")) {
        throw new Error("O valor após o desconto precisa ser de pelo menos R$ 5,00.");
      }
      throw new Error(message);
    }
    return result as {
      ok: true;
      status: QuoteReviewStatus;
      offer_quote_id?: string;
      offer_number?: number;
      offer_total?: number;
      credit_mode?: "none" | "invoice";
      credit_days?: number | null;
    };
  });
