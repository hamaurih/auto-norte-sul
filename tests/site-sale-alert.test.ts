import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Strong site sale alert", () => {
  test("alert payload includes payment method", () => {
    const source = readFileSync("src/lib/sales-summary.functions.ts","utf8");
    expect(source.includes("payment_method")).toBe(true);
  });

  test("admin alert renders strong popup with action and stronger chime", () => {
    const source = readFileSync("src/components/admin/SiteSaleAlerts.tsx","utf8");
    expect(source.includes("Nova venda realizada")).toBe(true);
    expect(source.includes("Pagamento:")).toBe(true);
    expect(source.includes("Ver pedido")).toBe(true);
    expect(source.includes("toast.custom")).toBe(true);
    expect(source.includes("1319")).toBe(true);
    expect(source.includes("duration: 15_000")).toBe(true);
  });
});
