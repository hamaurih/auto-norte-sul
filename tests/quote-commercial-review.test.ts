import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const file = (path: string) => readFileSync(path, "utf8");
const has = (source: string, needle: string) => expect(source.includes(needle)).toBe(true);

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
    has(customerUi, "Opção 1 — Transformar em compra");
    has(customerUi, "Opção 2 — Enviar para análise");
    has(customerUi, "Comprar agora");
    has(customerUi, "Confirmar envio para análise");
    has(customerUi, "requestQuoteCommercialReview");
    has(customerUi, "convertMyQuoteToPurchase");
    has(customerUi, "não cria cobrança nem reserva estoque");
  });

  test("somente cliente proprietário pode solicitar análise no tenant correto", () => {
    has(queueSql, "v_quote.customer_id");
    has(queueSql, "user_id=p_user_id and active");
    has(queueSql, "QUOTE_NOT_OWNED_BY_USER");
    has(queueSql, "v_quote.valid_until<now()");
    has(queueSql, "where id=p_quote_id and tenant_id=p_tenant_id");
    has(queueSql, "ONLY_STOREFRONT_QUOTES");
    has(managerFn, "p_user_id: context.userId");
  });

  test("vendas continuam livres de aprovação de análise", () => {
    has(conversionSql, "p_payment_method not in ('pix','cartao','boleto','faturado_b2b')");
    has(conversionSql, "q.status not in ('rascunho','enviado','em_negociacao','aprovado')");
    has(conversionSql, "reserved=reserved+v_item.qty");
    has(conversionSql, "for update of ps skip locked");
  });

  test("análise não confere automaticamente crédito nem desconto", () => {
    has(queueSql, "status text not null default 'pending'");
    has(queueSql, "status='offered'");
    has(queueSql, "status='denied'");
    has(queueSql, "v_quote.total-p_additional_discount");
    has(queueSql, "quote_reviews_unique_source");
    has(queueSql, "p_additional_discount");
    has(queueSql, "MINIMUM_CHECKOUT_AMOUNT");
    has(managerUi, "Aprovar e enviar proposta ao cliente");
    has(managerUi, "Não conceder condições especiais");
  });

  test("somente gestor autoriza uma oferta, sem alterar original", () => {
    has(queueSql, "m.role in ('owner','admin','manager')");
    has(queueSql, "MANAGER_PERMISSION_REQUIRED");
    has(queueSql, "parent_quote_id");
    has(queueSql, "original_total");
    has(queueSql, "now()+interval '48 hours'");
    has(queueSql, "analise_aprovada");
    has(managerFn, '["owner", "admin", "manager"]');
  });

  test("crédito faturado restrito a B2B apto com condições ativas", () => {
    has(queueSql, "v_customer.customer_group::text not in ('revendedor','oficina','distribuidor')");
    has(queueSql, "v_customer.b2b_status::text<>'approved'");
    has(queueSql, "and a.allow_invoice");
    has(queueSql, "CUSTOMER_CREDIT_NOT_APPROVED");
    has(conversionSql, "CREDIT_NOT_AUTHORIZED_FOR_QUOTE");
    has(conversionSql, "CREDIT_TERMS_CHANGED");
    has(conversionSql, "v_credit_days");
    has(managerUi, "Crédito faturado B2B");
  });

  test("não permite duas compras de versões de um mesmo orçamento", () => {
    has(conversionSql, "QUOTE_FAMILY_ALREADY_CONVERTED");
    has(conversionSql, "status='converted'");
    has(conversionSql, "converted_order_id=v_order_id");
    has(conversionSql, "QUOTE_OFFER_NOT_AVAILABLE");
    has(customerFn, "familyConverted");
  });

  test("requisições sensíveis nunca ficam públicas", () => {
    has(queueSql, "enable row level security");
    has(queueSql, "revoke all on public.quote_commercial_reviews from public,anon,authenticated");
    has(queueSql, "from public,anon,authenticated");
    has(queueSql, "to service_role");
    has(conversionSql, "from public,anon,authenticated");
    has(managerFn, "requireTenantRole");
  });

  test("resposta do gestor aparece apenas na área do cliente certo", () => {
    has(customerFn, '.in("customer_id",customerIds)');
    has(customerFn, "is_commercial_offer");
    has(customerFn, "can_request_review");
    has(customerUi, "O gestor enviou uma nova proposta");
    has(customerUi, "Condições comerciais liberadas pelo gestor");
  });

  test("checkout reaproveita faturamento B2B sem elevar permissão", () => {
    has(checkout, '["pix", "cartao", "boleto", "faturado_b2b"].includes(paymentMethod)');
    has(order, "Crédito faturado somente para pedidos previamente autorizados.");
    has(order, "Crédito faturado B2B não está mais autorizado.");
    has(order, "invoiceDueDays");
    has(checkout, "finalizeInvoice");
  });
});
