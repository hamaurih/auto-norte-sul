import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Orçamento autônomo e seguro da loja", () => {
  const sql = read("supabase/migrations/20261030193000_self_service_storefront_quotes.sql");
  const quoteFns = read("src/lib/my-quotes.functions.ts");
  const quotePage = read("src/routes/_authenticated/orcamentos.tsx");
  const preview = read("src/routes/orcamento.tsx");
  const cart = read("src/routes/carrinho.tsx");

  test("qualquer visitante visualiza prévia e cliente gera orçamento sem aprovação", () => {
    expect(preview).toContain('createFileRoute("/orcamento")');
    expect(preview).toContain("Subtotal estimado");
    expect(preview).toContain("window.print()");
    expect(cart).toContain("generateQuote");
    expect(cart).toContain("createMyQuoteFromCart");
    expect(quoteFns).toContain("internal_create_storefront_quote");
    expect(sql).toContain("'site','enviado','orcamento'");
    expect(sql).toContain("Gerado automaticamente no site, sem aprovação.");
  });

  test("a criação utiliza service_role e preços do servidor, nunca do navegador", () => {
    expect(sql).toContain("if coalesce(auth.role(),'')<>'service_role'");
    expect(sql).toContain("public.validate_cart_items(p_tenant_id,p_items)");
    expect(sql).toContain("v_product.price_b2b_a");
    expect(sql).toContain("v_product.price_b2c");
    expect(sql).toContain("v_product.available_for_online");
    expect(sql).toContain("quotes_storefront_request_unique");
    expect(sql).toContain("revoke all on function public.internal_create_storefront_quote");
  });

  test("conversão não exige liberador humano, mas restringe ao proprietário", () => {
    expect(sql).toContain("q.status not in ('rascunho','enviado','em_negociacao','aprovado')");
    expect(sql).not.toContain("QUOTE_NOT_RELEASED");
    expect(sql).toContain("QUOTE_NOT_OWNED_BY_USER");
    expect(sql).toContain("QUOTE_EXPIRED");
    const own = sql.indexOf("if not found then raise exception 'QUOTE_NOT_OWNED_BY_USER'");
    const reuse = sql.indexOf("if q.status='convertido'");
    expect(own).toBeGreaterThan(0);
    expect(reuse).toBeGreaterThan(own);
    expect(sql).toContain("Loja virtual (automático)");
    expect(sql).toContain("v_channel_id,'delivery'");
  });

  test("não associa orçamentos por coincidência de email ou nome", () => {
    expect(quoteFns).not.toContain('ilike("customer_email"');
    expect(quoteFns).toContain('.in("customer_id",customerIds)');
    expect(quoteFns).toContain('can_buy:["rascunho","enviado","em_negociacao","aprovado"]');
    expect(quotePage).toContain("sem aprovação da loja");
  });

  test("a reserva de estoque e o pagamento permanecem no núcleo transacional", () => {
    expect(sql).toContain("for update of ps skip locked");
    expect(sql).toContain("reserved=reserved+v_item.qty");
    expect(sql).toContain("stock_reservations");
    expect(sql).toContain("q.subtotal,q.shipping_amount,q.discount,q.total");
    expect(quotePage).toContain("Transformar orçamento em compra");
    expect(quotePage).toContain('to:"/checkout"');
    expect(read("src/lib/order.functions.ts")).toContain("updatePendingOrderCheckout");
    expect(read("src/routes/checkout.tsx")).toContain("updatePendingCheckout");
  });
});
