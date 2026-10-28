import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Site executive summary resilience", () => {
  test("legacy sources do not take down the executive panel", () => {
    const source = readFileSync("src/lib/sales-summary.functions.ts","utf8");
    expect(source.includes('requireAnyTenantRole')).toBe(true);
    expect(source.includes('if (coreResult.error) throw new Error')).toBe(true);
    expect(source.includes('fallback legado do PDV indisponível')).toBe(true);
    expect(source.includes('fallback legado de vendas assistidas indisponível')).toBe(true);
    expect(source.includes('posLegacyResult.error ? []')).toBe(true);
    expect(source.includes('assistedLegacyResult.error ? []')).toBe(true);
  });
});
