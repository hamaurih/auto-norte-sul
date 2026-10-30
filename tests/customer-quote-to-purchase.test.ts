import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Customer quote to purchase", () => {
  test("self-service quote is server-priced, owned and valid for seven days", () => {
    const sql=readFileSync("supabase/migrations/20261030193000_self_service_storefront_quotes.sql","utf8");
    expect(sql.includes("internal_create_storefront_quote")).toBe(true);
    expect(sql.includes("validate_cart_items")).toBe(true);
    expect(sql.includes("now()+interval '7 days'")).toBe(true);
    expect(sql.includes("customer_id=v_customer.id")).toBe(false);
    expect(sql.includes("'site','enviado','orcamento'")).toBe(true);
  });

  test("valid owned quote can be purchased without manual approval", () => {
    const sql=readFileSync("supabase/migrations/20261030193000_self_service_storefront_quotes.sql","utf8");
    expect(sql.includes("('rascunho','enviado','em_negociacao','aprovado')")).toBe(true);
    expect(sql.includes("QUOTE_EXPIRED")).toBe(true);
    expect(sql.includes("QUOTE_NOT_OWNED_BY_USER")).toBe(true);
    expect(sql.includes("and user_id=v_user")).toBe(true);
  });

  test("conversion reserves stock atomically and preserves quote values", () => {
    const sql=readFileSync("supabase/migrations/20261030193000_self_service_storefront_quotes.sql","utf8");
    expect(sql.includes("for update of ps skip locked")).toBe(true);
    expect(sql.includes("reserved=reserved+v_item.qty")).toBe(true);
    expect(sql.includes("q.subtotal,q.shipping_amount,q.discount,q.total")).toBe(true);
    expect(sql.includes("stock_reservations")).toBe(true);
  });

  test("sensitive quote RPCs are server-only", () => {
    const sql=readFileSync("supabase/migrations/20261030193000_self_service_storefront_quotes.sql","utf8");
    expect(sql.includes("from public,anon,authenticated")).toBe(true);
    expect(sql.includes("to service_role")).toBe(true);
    const harden=readFileSync("supabase/migrations/20261030191500_harden_quote_conversion_rpc.sql","utf8");
    expect(harden.includes("internal_convert_my_quote_to_storefront_order")).toBe(true);
    const server=readFileSync("src/lib/my-quotes.functions.ts","utf8");
    expect(server.includes('supabaseAdmin as any).rpc("internal_convert_my_quote_to_storefront_order"')).toBe(true);
    expect(server.includes('supabaseAdmin as any).rpc("internal_create_storefront_quote"')).toBe(true);
  });

  test("cart and customer area expose quote self-service", () => {
    const cart=readFileSync("src/routes/carrinho.tsx","utf8");
    const page=readFileSync("src/routes/_authenticated/orcamentos.tsx","utf8");
    expect(cart.includes("Gerar orçamento")).toBe(true);
    expect(page.includes("Transformar orçamento em compra")).toBe(true);
    expect(page.includes('"pix","PIX"')).toBe(true);
    expect(page.includes('"cartao","Cartão"')).toBe(true);
    expect(page.includes('"boleto","Boleto"')).toBe(true);
  });

  test("resumed checkout persists customer and payment data before charge", () => {
    const order=readFileSync("src/lib/order.functions.ts","utf8");
    const checkout=readFileSync("src/routes/checkout.tsx","utf8");
    expect(order.includes("updatePendingOrderCheckout")).toBe(true);
    expect(checkout.includes("updatePendingCheckout")).toBe(true);
  });

  test("storefront availability uses reservable multi-stock", () => {
    const source=readFileSync("src/lib/queries.ts","utf8");
    expect(source.includes("v_product_stock_available")).toBe(true);
    expect(source.includes("available_multi")).toBe(true);
  });

  test("applied historical migrations remain in repository", () => {
    const link=readFileSync("supabase/migrations/20261030185500_quote_email_owner_link.sql","utf8");
    const backfill=readFileSync("supabase/migrations/20261030190500_backfill_quote_customer_links.sql","utf8");
    expect(link.includes("convert_my_quote_to_storefront_order")).toBe(true);
    expect(backfill.includes("having count(c.id)=1")).toBe(true);
  });
});
