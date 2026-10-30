import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Official non-fiscal receipt", () => {
  test("prints from immutable sales_receipts snapshot", () => {
    const component = readFileSync("src/components/receipts/ImmutableSaleReceipt.tsx","utf8");
    expect(component.includes("COMPROVANTE NÃO FISCAL DE VENDA")).toBe(true);
    expect(component.includes("DOCUMENTO NÃO FISCAL")).toBe(true);
    expect(component.includes("A emissão fiscal é realizada separadamente por usuário autorizado.")).toBe(true);
    expect(component.includes("receipt.snapshot_hash")).toBe(true);
    expect(component.includes("items_snapshot")).toBe(false);
  });

  test("customer receipt is loaded through ownership-checked server function", () => {
    const server = readFileSync("src/lib/sales-receipts.functions.ts","utf8");
    const page = readFileSync("src/routes/_authenticated/pedidos.tsx","utf8");
    expect(server.includes("getMyOrderReceipt")).toBe(true);
    expect(server.includes('.eq("user_id",context.userId)')).toBe(true);
    expect(page.includes("getMyOrderReceipt")).toBe(true);
    expect(page.includes("ImmutableSaleReceipt")).toBe(true);
  });

  test("admin and PDV prefer the same immutable receipt", () => {
    const admin = readFileSync("src/routes/_authenticated/admin.pedidos.$id.tsx","utf8");
    const pdv = readFileSync("src/components/pdv/PdvSaleDetailSheet.tsx","utf8");
    expect(admin.includes("Imprimir recibo não fiscal")).toBe(true);
    expect(admin.includes("ImmutableSaleReceipt")).toBe(true);
    expect(pdv.includes("pdv-immutable-receipt")).toBe(true);
    expect(pdv.includes("ImmutableSaleReceipt")).toBe(true);
  });
});
