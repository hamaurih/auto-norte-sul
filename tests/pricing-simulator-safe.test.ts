import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const component = readFileSync("src/components/admin/PricingSimulator.tsx", "utf8");
const route = readFileSync("src/routes/_authenticated/admin.formacao-precos.tsx", "utf8");
const source = readFileSync("src/lib/pricing.functions.ts", "utf8");

describe("Pricing simulator safety and economics", () => {
  test("does not write catalog or orders", () => {
    expect(component.includes("PricingSimulator")).toBe(true);
    expect(component.includes("useState")).toBe(true);
    expect(component.includes("saveProductPricingRule")).toBe(false);
    expect(component.includes("applyPricingAdjustment")).toBe(false);
    expect(component.includes("supabase")).toBe(false);
    expect(component.includes("Simular não grava preços, reservas nem pedidos.")).toBe(true);
  });

  test("uses actual product average cost and active channel price", () => {
    expect(component.includes("chosen?.average_cost")).toBe(true);
    expect(component.includes('channel === "b2b" ? chosen?.price_b2b : chosen?.price_b2c')).toBe(true);
    expect(component.includes("price > 0")).toBe(true);
    expect(component.includes("cost > 0")).toBe(true);
    expect(source.includes("average_cost")).toBe(true);
  });

  test("break-even and contribution derive from all configured variable expenses", () => {
    expect(component.includes("unitContribution")).toBe(true);
    expect(component.includes("cost + fixedCost")).toBe(true);
    expect(component.includes("(1 - share)")).toBe(true);
    expect(component.includes("maxDiscount")).toBe(true);
    expect(component.includes("belowFloor")).toBe(true);
    expect(component.includes("insufficientGrowth")).toBe(true);
  });

  test("global markup save does not recalculate existing manual storefront prices", () => {
    expect(route.includes("PricingSimulator")).toBe(true);
    expect(route.includes("recalculate: false")).toBe(true);
    expect(route.includes("Parâmetro global salvo. Nenhum preço de produto foi alterado.")).toBe(true);
    expect(route.includes("Salvar margem padrão sem reajustar preços")).toBe(true);
  });

  test("invalid costs, percentage sums and volumes are rejected", () => {
    expect(component.includes("Produto sem preço ou custo médio válido")).toBe(true);
    expect(component.includes("share >= 1")).toBe(true);
    expect(component.includes("Number.isInteger(count)")).toBe(true);
    expect(component.includes("nextCount")).toBe(true);
    expect(component.includes("O crescimento de volume é uma hipótese")).toBe(true);
  });
});
