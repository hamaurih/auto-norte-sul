import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Fiscal Bling traceability", () => {
  test("automatic sync remains read-only", () => {
    const source = readFileSync("src/lib/fiscal-bling.functions.ts","utf8");
    expect(source.includes('blingGet("/pedidos/vendas/"')).toBe(true);
    expect(source.includes('blingGet("/nfe/"')).toBe(true);
    expect(source.includes("syncBlingFiscalTraceWorker")).toBe(true);
  });

  test("human command is the only fiscal write path", () => {
    const source = readFileSync("src/lib/fiscal-bling.functions.ts","utf8");
    expect(source.includes("issueReceiptNfeViaBling")).toBe(true);
    expect(source.includes('blingJson("POST","/nfe"')).toBe(true);
    expect(source.includes('"/enviar?enviarEmail="')).toBe(true);
    expect(source.includes("claim_bling_nfe_emission")).toBe(true);
    expect(source.includes("FISCAL_RECEIPT_MISMATCH")).toBe(true);
  });

  test("invoice mirror is idempotent and detects provider conflicts", () => {
    const source = readFileSync("src/lib/fiscal-bling.functions.ts","utf8");
    expect(source.includes("provider_reference")).toBe(true);
    expect(source.includes("CONFLITO_FISCAL")).toBe(true);
    expect(source.includes("fiscal.bling_synced")).toBe(true);
  });

  test("cron fiscal requires server-side secret", () => {
    const source = readFileSync("src/routes/api/public/cron.bling-fiscal-sync.ts","utf8");
    expect(source.includes("CRON_SECRET")).toBe(true);
    expect(source.includes("timingSafeEqual")).toBe(true);
    expect(source.includes("status:401")).toBe(true);
  });
});
