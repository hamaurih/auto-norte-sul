import { describe, it } from "node:test";
import assert from "node:assert/strict";
const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
  toBeNull: () => assert.equal(actual, null),
  toContain: (expected: string) =>
    assert.ok(typeof actual === "string" && actual.includes(expected)),
  toBeCloseTo: (expected: number) =>
    assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 0.00001),
});
import { simulateProduct, summarizeCatalog } from "../src/lib/tax-product-scenarios.ts";
import type { TaxProduct, TaxOptions } from "../src/lib/tax-product-scenarios.ts";
const product: TaxProduct = {
  id: "1",
  name: "Peça",
  sku: "A",
  price_b2c: 100,
  price_b2b: 80,
  average_cost: 60,
  profile: {
    ncm: "87089990",
    cest: "01.999.00",
    icms_cst: "60",
    icms_csosn: null,
    icms_rate: 20,
    pis_cst: "04",
    cofins_cst: "04",
    pis_rate: 0,
    cofins_rate: 0,
  },
};
const options: TaxOptions = {
  channel: "counter",
  uf: "PB",
  internalRate: 20,
  povertyRate: 0,
  protocol: false,
  mva: null,
};
describe("PB product tax scenarios", () => {
  it("does not charge prepaid ST twice and segregates CBS/IBS only", () => {
    const s = simulateProduct(product, options);
    if (s.pending !== null) throw Error(s.pending);
    expect(s.today).toBe(0);
    expect(s.future).toBe(11.3);
    expect(s.splitRate).toBe(11.3);
    expect(s.split).toBe(11.3);
    expect(s.deposit).toBe(88.7);
    expect(s.profitFuture).toBe(28.7);
    expect(s.profitConsumed).toBe(28.25);
  });
  it("calculates B2C DIFAL/FCP and preserves legacy ICMS in 2027", () => {
    const s = simulateProduct(product, {
      ...options,
      channel: "b2c",
      uf: "RJ",
      internalRate: 22,
      povertyRate: 2,
    });
    if (s.pending !== null) throw Error(s.pending);
    expect(s.difal).toBe(12);
    expect(s.today).toBe(24);
    expect(s.future).toBe(35.3);
    expect(s.netAfterTaxes).toBe(64.7);
    expect(s.deposit).toBe(88.7);
  });
  it("requires MVA with a protocol and uses the B2B price", () => {
    expect(
      simulateProduct(product, { ...options, channel: "b2b", uf: "SP", protocol: true }).pending,
    ).toContain("MVA");
    const s = simulateProduct(product, {
      ...options,
      channel: "b2b",
      uf: "SP",
      protocol: true,
      mva: 40,
    });
    if (s.pending !== null) throw Error(s.pending);
    expect(s.st).toBeCloseTo(16);
    expect(s.today).toBe(22.4);
    expect(s.price).toBe(80);
  });
  it("keeps missing classification out of averages", () => {
    const s = summarizeCatalog([product, { ...product, id: "2", profile: null }], options);
    expect(s.count).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.future).toBeCloseTo(11.3);
  });
  it("uses individual federal rates and does not infer monophase from CEST", () => {
    const s = simulateProduct(
      {
        ...product,
        profile: {
          ...product.profile!,
          pis_cst: "01",
          cofins_cst: "01",
          pis_rate: 1.65,
          cofins_rate: 7.6,
        },
      },
      options,
    );
    if (s.pending !== null) throw Error(s.pending);
    expect(s.todayRate).toBe(9.25);
    expect(s.delta).toBe(2.05);
  });
  it("includes each product destination override in the complete catalog average", () => {
    const s = summarizeCatalog(
      [product, { ...product, id: "2" }],
      { ...options, channel: "b2c", uf: "SP" },
      { "2": { internalRate: 22, povertyRate: 2 } },
    );
    expect(s.count).toBe(2);
    expect(s.today).toBe(22);
    expect(s.future).toBeCloseTo(33.3);
  });
  it("does not fabricate profit without cost or accept invalid destination", () => {
    const s = simulateProduct({ ...product, average_cost: null }, options);
    if (s.pending !== null) throw Error(s.pending);
    expect(s.profitFuture).toBeNull();
    expect(simulateProduct(product, { ...options, channel: "b2c" }).pending).toContain("UF");
  });
});
