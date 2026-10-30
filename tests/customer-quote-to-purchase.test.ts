import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Customer quote to purchase", () => {
  test("customer can only buy released valid quote", () => {
    const sql=readFileSync("supabase/migrations/20261030182500_customer_quote_to_purchase.sql","utf8");
    expect(sql.includes("q.status not in ('enviado','aprovado')")).toBe(true);
    expect(sql.includes("QUOTE_EXPIRED")).toBe(true);
    expect(sql.includes("QUOTE_NOT_OWNED_BY_USER")).toBe(true);
    const linkSql=readFileSync("supabase/migrations/20261030185500_quote_email_owner_link.sql","utf8");
    expect(linkSql.includes("lower(q.customer_email)<>lower(v_auth_email)")).toBe(true);
    const backfill=readFileSync("supabase/migrations/20261030190500_backfill_quote_customer_links.sql","utf8");
    expect(backfill.includes("having count(c.id)=1")).toBe(true);
  });

  test("conversion reserves stock atomically and preserves quote values", () => {
    const sql=readFileSync("supabase/migrations/20261030182500_customer_quote_to_purchase.sql","utf8");
    expect(sql.includes("for update of ps skip locked")).toBe(true);
    expect(sql.includes("reserved=reserved+v_item.qty")).toBe(true);
    expect(sql.includes("q.subtotal,q.shipping_amount,q.discount,q.total")).toBe(true);
    expect(sql.includes("stock_reservations")).toBe(true);
  });

  test("customer UI offers quote purchase and payment choices", () => {
    const page=readFileSync("src/routes/_authenticated/orcamentos.tsx","utf8");
    expect(page.includes("Transformar orçamento em compra")).toBe(true);
    expect(page.includes('"pix","PIX"')).toBe(true);
    expect(page.includes('"cartao","Cartão"')).toBe(true);
    expect(page.includes('"boleto","Boleto"')).toBe(true);
    expect(page.includes('to:"/checkout"')).toBe(true);
  });

  test("resumed checkout persists customer and payment data before charge", () => {
    const order=readFileSync("src/lib/order.functions.ts","utf8");
    const checkout=readFileSync("src/routes/checkout.tsx","utf8");
    expect(order.includes("updatePendingOrderCheckout")).toBe(true);
    expect(checkout.includes("updatePendingCheckout")).toBe(true);
    const harden=readFileSync("supabase/migrations/20261030191500_harden_quote_conversion_rpc.sql","utf8");
    expect(harden.includes("from public,anon,authenticated")).toBe(true);
    expect(harden.includes("internal_convert_my_quote_to_storefront_order")).toBe(true);
    const server=readFileSync("src/lib/my-quotes.functions.ts","utf8");
    expect(server.includes('supabaseAdmin as any).rpc("internal_convert_my_quote_to_storefront_order"')).toBe(true);
  });

  test("storefront stock is hydrated from available stock view", () => {
    const source=readFileSync("src/lib/queries.ts","utf8");
    expect(source.includes("v_product_stock_available")).toBe(true);
    expect(source.includes("available_multi")).toBe(true);
  });
});
