import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20261031190000_allow_manual_product_deactivation.sql","utf8");
const productsFn = readFileSync("src/lib/products.functions.ts","utf8");

describe("manual product deactivation", () => {
  it("never forces active=true just because stock is positive", () => {
    expect(migration).toContain("coalesce(new.stock, 0) <= 0");
    expect(migration).not.toContain("new.active := true");
  });

  it("still auto-deactivates deleted or out-of-stock products", () => {
    expect(migration).toContain("new.deleted_at is not null");
    expect(migration).toContain("new.active := false");
  });

  it("verifies that toggles really persisted", () => {
    expect(productsFn).toContain('.select("id, active, featured, is_new, is_bestseller, is_offer")');
    expect(productsFn).toContain("Produto não foi alterado");
    expect(productsFn).toContain("O status solicitado não foi persistido");
  });
});
