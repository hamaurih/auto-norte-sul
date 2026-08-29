import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const srcRoot = join(root, "src");
const failures = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const runtimeFiles = walk(srcRoot).filter((p) => /\.(ts|tsx)$/.test(p));
for (const file of runtimeFiles) {
  const rel = relative(root, file);
  const source = readFileSync(file, "utf8");
  if (/\.from\(\s*["']user_roles["']\s*\)/.test(source)) {
    failures.push(`${rel}: runtime ainda consulta user_roles`);
  }
  if (/source_products|source_stock|source_price_b2c/.test(source)) {
    failures.push(`${rel}: flag legado de Bling como source-of-truth ainda existe em runtime`);
  }
}

const blingPath = join(srcRoot, "lib", "bling.functions.ts");
const bling = readFileSync(blingPath, "utf8");
if (!bling.includes('@/integrations/supabase/tenant-auth')) {
  failures.push("src/lib/bling.functions.ts: middleware tenant-aware ausente");
}
if (!bling.includes("context.tenantId")) {
  failures.push("src/lib/bling.functions.ts: tenantId não é usado");
}
if (/\.from\(\s*["']products["']\s*\)\s*\.update\([\s\S]{0,500}\bstock\s*:/.test(bling)) {
  failures.push("src/lib/bling.functions.ts: adaptador Bling ainda escreve products.stock");
}
for (const fn of ["syncBlingProducts", "syncBlingStock", "syncBlingPrices", "syncBlingCustomers"]) {
  if (!bling.includes(`export const ${fn}`)) failures.push(`Bling: ${fn} ausente`);
}
if (!bling.includes("Sincronização de entrada desativada: o ERP Norte Sul é a fonte oficial")) {
  failures.push("Bling: bloqueio explícito de sincronização de entrada ausente");
}
if (!bling.includes('.eq("tenant_id", context.tenantId)')) {
  failures.push("Bling: consultas de configuração/log não demonstram escopo explícito por tenant");
}

const oauthPath = join(srcRoot, "lib", "bling-oauth.functions.ts");
const oauth = readFileSync(oauthPath, "utf8");
if (!oauth.includes('@/integrations/supabase/tenant-auth') || !oauth.includes("context.tenantId")) {
  failures.push("Bling OAuth: início da autorização não está tenant-aware");
}
if (!oauth.includes("tenant_id: context.tenantId")) {
  failures.push("Bling OAuth: state não grava tenant_id");
}

const callbackPath = join(srcRoot, "routes", "api", "public", "bling.callback.ts");
const callback = readFileSync(callbackPath, "utf8");
if (!callback.includes("tenant_id") || !callback.includes("config_id")) {
  failures.push("Bling OAuth callback: tenant_id/config_id ausentes");
}
if (/from\(["']bling_config["']\)[\s\S]{0,300}\.limit\(1\)/.test(callback)) {
  failures.push("Bling OAuth callback: seleção global de bling_config por limit(1) proibida");
}
if (!callback.includes("used_at") || !callback.includes("expires_at") || !callback.includes("state_hash")) {
  failures.push("Bling OAuth callback: hardening de state de uso único ausente");
}

const migration = join(root, "supabase", "migrations", "20260829173000_phase1_single_erp_core.sql");
if (!existsSync(migration)) failures.push("Migration Fase 1 não versionada");

if (failures.length) {
  console.error("PHASE 1 ERP CORE GATE FAILED\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}
console.log("Phase 1 ERP core invariants OK");
