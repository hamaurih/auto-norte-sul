import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("PDV cash and contingency contract", () => {
  test("database hardening protects open terminal, cash drawer and payments", () => {
    const sql = readFileSync("supabase/migrations/20261027145500_pdv_cash_hardening.sql", "utf8");
    expect(sql.includes("pos_cash_sessions_one_open_terminal_idx")).toBe(true);
    expect(sql.includes("INSUFFICIENT_CASH_DRAWER")).toBe(true);
    expect(sql.includes("pos_payments_amount_positive")).toBe(true);
    expect(sql.includes("pos_payments_installments_range")).toBe(true);
    expect(sql.includes("pos_payments_reference_required")).toBe(true);
    expect(sql.includes("CUSTOMER_REQUIRED_FOR_CREDIT_PAYMENT")).toBe(true);
    expect(sql.includes("get_pos_cash_session_snapshot")).toBe(true);
  });

  test("checkout persists a pending sale and reuses its idempotency key", () => {
    const source = readFileSync("src/components/pdv/PdvCheckoutPanel.tsx", "utf8");
    expect(source.includes('PENDING_SALE_KEY = "norte-sul:pdv:pending-sale:v1"')).toBe(true);
    expect(source.includes("persistPending(payload)")).toBe(true);
    expect(source.includes("idempotencyKey: payload.idempotencyKey")).toBe(true);
    expect(source.includes("retryPending")).toBe(true);
    expect(source.includes("provider_reference")).toBe(true);
    expect(source.includes("installments")).toBe(true);
  });

  test("mixed payments remain an array sent atomically to finalize_pos_sale", () => {
    const source = readFileSync("src/lib/pos.functions.ts", "utf8");
    expect(source.includes("payments: Array")).toBe(true);
    expect(source.includes("p_payments: data.payments")).toBe(true);
    expect(source.includes("p_idempotency_key: data.idempotencyKey")).toBe(true);
  });
});
