import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Immutable sales receipt fiscal flow", () => {
  test("receipt is immutable and captured from effective sales", () => {
    const sql = readFileSync("supabase/migrations/20261027182500_immutable_sales_receipts.sql","utf8");
    expect(sql.includes("IMMUTABLE_SALES_RECEIPT")).toBe(true);
    expect(sql.includes("capture_sales_receipt_from_order")).toBe(true);
    expect(sql.includes("trg_order_capture_sales_receipt")).toBe(true);
    expect(sql.includes("trg_pos_link_capture_sales_receipt")).toBe(true);
    expect(sql.includes("snapshot_hash")).toBe(true);
  });

  test("fiscal decision is explicit and role-gated", () => {
    const sql = readFileSync("supabase/migrations/20261027182500_immutable_sales_receipts.sql","utf8");
    expect(sql.includes("request_invoice")).toBe(true);
    expect(sql.includes("defer")).toBe(true);
    expect(sql.includes("owner','admin','manager','sales")).toBe(true);
  });

  test("fiscal draft uses receipt snapshot and disables order bypass", () => {
    const sql = readFileSync("supabase/migrations/20261027183500_receipt_fiscal_gate.sql","utf8");
    expect(sql.includes("create_fiscal_draft_from_receipt")).toBe(true);
    expect(sql.includes("FISCAL_EMISSION_NOT_REQUESTED")).toBe(true);
    expect(sql.includes("items_snapshot")).toBe(true);
    expect(sql.includes("receipt_snapshot_hash")).toBe(true);
    expect(sql.includes("revoke execute on function public.create_fiscal_draft_from_order")).toBe(true);
  });

  test("admin order exposes receipt decision controls", () => {
    const source = readFileSync("src/routes/_authenticated/admin.pedidos.$id.tsx","utf8");
    expect(source.includes("Recibo da venda")).toBe(true);
    expect(source.includes("Não emitir agora")).toBe(true);
    expect(source.includes("Solicitar emissão")).toBe(true);
    expect(source.includes("Preparar NF-e")).toBe(true);
  });
});
