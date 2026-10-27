import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("PDV cash and contingency contract", () => {
  test("database hardening protects open terminal, cash drawer and payments", () => {
    const sql = readFileSync("supabase/migrations/20261027145500_pdv_cash_hardening.sql", "utf8");
    expect(sql).toContain("pos_cash_sessions_one_open_terminal_idx");
    expect(sql).toContain("INSUFFICIENT_CASH_DRAWER");
    expect(sql).toContain("pos_payments_amount_positive");
    expect(sql).toContain("pos_payments_installments_range");
    expect(sql).toContain("pos_payments_reference_required");
    expect(sql).toContain("CUSTOMER_REQUIRED_FOR_CREDIT_PAYMENT");
    expect(sql).toContain("get_pos_cash_session_snapshot");
  });

  test("checkout persists a pending sale and reuses its idempotency key", () => {
    const source = readFileSync("src/components/pdv/PdvCheckoutPanel.tsx", "utf8");
    expect(source).toContain('PENDING_SALE_KEY = "norte-sul:pdv:pending-sale:v1"');
    expect(source).toContain("persistPending(payload)");
    expect(source).toContain("idempotencyKey: payload.idempotencyKey");
    expect(source).toContain("retryPending");
    expect(source).toContain("provider_reference");
    expect(source).toContain("installments");
  });

  test("mixed payments remain an array sent atomically to finalize_pos_sale", () => {
    const source = readFileSync("src/lib/pos.functions.ts", "utf8");
    expect(source).toContain("payments: Array");
    expect(source).toContain("p_payments: data.payments");
    expect(source).toContain("p_idempotency_key: data.idempotencyKey");
  });
});
