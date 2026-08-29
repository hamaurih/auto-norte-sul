#!/usr/bin/env node
/**
 * Gate da Fase 1 — invariantes arquiteturais do ERP Norte Sul.
 *
 * Falha se:
 *  1. existir `.from("user_roles")` em src;
 *  2. aparecerem flags/narrativa de "Bling é fonte" em código de UI/runtime;
 *  3. houver update de `stock` em `products` nos adaptadores Bling;
 *  4. `bling_config`/`bling_sync_logs` forem usados sem `tenant_id` no arquivo;
 *  5. a migration 20260829173000_phase1_single_erp_core.sql não existir.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const failures = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk("src");
const isGeneratedTypes = (f) =>
  f.endsWith("src/integrations/supabase/types.ts") || f.endsWith("routeTree.gen.ts");

// 1. user_roles
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (/\.from\(\s*['"]user_roles['"]\s*\)/.test(src)) {
    failures.push(`${file}: uso runtime de public.user_roles (descontinuada na Fase 1)`);
  }
}

// 2. Bling como fonte de verdade
const SOURCE_FLAGS = /\b(source_products|source_stock|source_price_b2c)\b/;
const MASTER_NARRATIVE =
  /(Bling é (a )?(fonte|source)(?! of truth)|Bling controla (preço|estoque|produto)|é (a )?source of truth|modo espelho|mirror mode)/i;
for (const file of files) {
  if (isGeneratedTypes(file)) continue;
  const src = readFileSync(file, "utf8");
  if (SOURCE_FLAGS.test(src)) {
    failures.push(`${file}: flag de "Bling é fonte" (source_products/source_stock/source_price_b2c)`);
  }
  if (MASTER_NARRATIVE.test(src)) {
    failures.push(`${file}: narrativa de Bling como fonte de verdade / modo espelho`);
  }
}

// 3. writes de stock em products dentro dos adaptadores Bling
for (const file of files.filter((f) => /bling/i.test(f))) {
  const src = readFileSync(file, "utf8");
  if (/from\(\s*['"]products['"]\s*\)[\s\S]{0,400}?\.update\(\{[\s\S]{0,400}?\bstock\b\s*:/.test(src)) {
    failures.push(`${file}: adaptador Bling escrevendo products.stock (canônico é product_stock)`);
  }
  if (/\bstock\s*:\s*estoque\b/.test(src)) {
    failures.push(`${file}: adaptador Bling atribuindo estoque do Bling a products.stock`);
  }
}

// 4. bling_config / bling_sync_logs sem tenant_id (server functions em src/lib)
for (const file of files) {
  if (isGeneratedTypes(file) || !file.startsWith("src/lib")) continue;
  const src = readFileSync(file, "utf8");
  if (/from\(\s*['"]bling_(config|sync_logs)['"]\s*\)/.test(src) && !/tenant_id/.test(src)) {
    failures.push(`${file}: acesso a bling_config/bling_sync_logs sem tenant_id`);
  }
}

// 5. migration obrigatória
const MIGRATION = "supabase/migrations/20260829173000_phase1_single_erp_core.sql";
if (!existsSync(MIGRATION)) {
  failures.push(`migration ausente: ${MIGRATION}`);
}

if (failures.length > 0) {
  console.error("Gate Fase 1 FALHOU:\n" + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("Gate Fase 1 OK: ERP Norte Sul é a única fonte oficial.");
