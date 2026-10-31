import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261031190000_allow_manual_product_deactivation.sql",
  "utf8",
);
const productsFn = readFileSync("src/lib/products.functions.ts", "utf8");

test("positive stock never forces a manually inactive product back to active", () => {
  assert.match(migration, /coalesce\(new\.stock, 0\) <= 0/);
  assert.doesNotMatch(migration, /new\.active\s*:=\s*true/);
});

test("deleted or out-of-stock products still become inactive", () => {
  assert.match(migration, /new\.deleted_at is not null/);
  assert.match(migration, /new\.active\s*:=\s*false/);
});

test("catalog toggle verifies persistence instead of returning false success", () => {
  assert.match(productsFn, /\.select\("id, active, featured, is_new, is_bestseller, is_offer"\)/);
  assert.match(productsFn, /Produto não foi alterado/);
  assert.match(productsFn, /O status solicitado não foi persistido/);
});
