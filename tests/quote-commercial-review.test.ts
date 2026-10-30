import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const file = (path: string) => readFileSync(path, "utf8");

const queueSql = file("supabase/migrations/20261030195000_quote_commercial_review_queue.sql");
const conversionSql = file("supabase/migrations/20261030195500_quote_review_conversion_guard.sql");
const customerUi = file("src/routes/_authenticated/orcamentos.tsx");
const customerFn = file("src/lib/my-quotes.functions.ts");
const managerUi = file("src/routes/_authenticated/admin.orcamentos.analises.tsx");
const managerFn = file("src/lib/quote-commercial-review.functions.ts");
const checkout = file("src/routes/checkout.tsx");
const order = file("src/lib/order.functions.ts");

describe("Fila de análise comercial do orçamento", () => {
  test("duas escolhas visíveis, com compra direta preservada", () => {
    expect(customerUi).toContain("Opção 1 — Transformar em compra");
    expect(customerUi).toContain("Opção 2 — Enviar para análise");
    expect(customerUi).toContain("Comprar agora");
    expect(customerUi).toContain("Confirmar envio para análise");
    expect(customerUi).toContain("requestQuoteCommercialReview");
    expect(customerUi).toContain("convertMyQuoteToPurchase");
    expect(customerUi).toContain("não cria cobrança nem reserva estoque");
  });

  test("somente cliente proprietário pode solicitar análise no tenant correto", () => {
    expect(queueSql).toContain("v_quote.customer_id");
    expect(queueSql).toContain("user_id=p_user_id and active");
    expect(queueSql).toContain("QUOTE_NOT_OWNED_BY_USER");
    expect(queueSql).toContain("v_quote.valid_until<now()");
    expect(queueSql).toContain("where id=p_quote_id and tenant_id=p_tenant_id");
    expect(queueSql).toContain("ONLY_STOREFRONT_QUOTES");
    expect(managerFn).toContain("p_user_id: context.userId");
  });

  test("vendas continuam livres de aprovação de análise", () => {
    expect(conversionSql).toContain("p_payment_method not in ('pix','cartao','boleto','faturado_b2b')");
    expect(conversionSql).toContain("q.status not in ('rascunho','enviado','em_negociacao','aprovado')");
    expect(conversionSql).toContain("reserved=reserved+v_item.qty");
    expect(conversionSql).toContain("for update of ps skip locked");
  });

  test("análise não confere automaticamente crédito nem desconto", () => {
    expect(queueSql).toContain("status text not null default 'pending'");
    expect(queueSql).toContain("status='offered'");
    expect(queueSql).toContain("status='denied'");
    expect(queueSql).toContain("v_quote.total-p_additional_discount");
    expect(queueSql).toContain("quote_reviews_unique_source");
    expect(queueSql).toContain("p_additional_discount");
    expect(queueSql).toContain("MINIMUM_CHECKOUT_AMOUNT");
    expect(managerUi).toContain("Aprovar e enviar proposta ao cliente");
    expect(managerUi).toContain("Não conceder condições especiais");
  });

  test("somente gestor autoriza uma oferta, sem alterar original", () => {
    expect(queueSql).toContain("m.role in ('owner','admin','manager')");
    expect(queueSql).toContain("MANAGER_PERMISSION_REQUIRED");
    expect(queueSql).toContain("parent_quote_id");
    expect(queueSql).toContain("original_total");
    expect(queueSql).toContain("now()+interval '48 hours'");
    expect(queueSql).toContain("analise_aprovada");
    expect(managerFn).toContain('["owner", "admin", "manager"]');
  });

  test("crédito faturado restrito a B2B apto com condições ativas", () => {
    expect(queueSql).toContain("v_customer.customer_group::text not in ('revendedor','oficina','distribuidor')");
    expect(queueSql).toContain("v_customer.b2b_status::text<>'approved'");
    expect(queueSql).toContain("and a.allow_invoice");
    expect(queueSql).toContain("CUSTOMER_CREDIT_NOT_APPROVED");
    expect(conversionSql).toContain("CREDIT_NOT_AUTHORIZED_FOR_QUOTE");
    expect(conversionSql).toContain("CREDIT_TERMS_CHANGED");
    expect(conversionSql).toContain("v_credit_days");
    expect(managerUi).toContain("Crédito faturado B2B");
  });

  test("não permite duas compras de versões de um mesmo orçamento", () => {
    expect(conversionSql).toContain("QUOTE_FAMILY_ALREADY_CONVERTED");
    expect(conversionSql).toContain("status='converted'");
    expect(conversionSql).toContain("converted_order_id=v_order_id");
    expect(conversionSql).toContain("QUOTE_OFFER_NOT_AVAILABLE");
    expect(customerFn).toContain("familyConverted");
  });

  test("requisições sensíveis nunca ficam públicas", () => {
    expect(queueSql).toContain("enable row level security");
    expect(queueSql).toContain("revoke all on public.quote_commercial_reviews from public,anon,authenticated");
    expect(queueSql).toContain("from public,anon,authenticated");
    expect(queueSql).toContain("to service_role");
    expect(conversionSql).toContain("from public,anon,authenticated");
    expect(managerFn).toContain("requireTenantRole");
  });

  test("resposta do gestor aparece apenas na área do cliente certo", () => {
    expect(customerFn).toContain('.in("customer_id",customerIds)');
    expect(customerFn).toContain("is_commercial_offer");
    expect(customerFn).toContain("can_request_review");
    expect(customerUi).toContain("O gestor enviou uma nova proposta");
    expect(customerUi).toContain("Condições comerciais liberadas pelo gestor");
  });

  test("checkout reaproveita faturamento B2B sem elevar permissão", () => {
    expect(checkout).toContain('["pix", "cartao", "boleto", "faturado_b2b"].includes(paymentMethod)');
    expect(order).toContain("Crédito faturado somente para pedidos previamente autorizados.");
    expect(order).toContain("Crédito faturado B2B não está mais autorizado.");
    expect(order).toContain("invoiceDueDays");
    expect(checkout).toContain("finalizeInvoice");
  });
});
