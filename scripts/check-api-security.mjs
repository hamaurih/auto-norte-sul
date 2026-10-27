import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(process.cwd(), "src", "routes", "api");
const allowedPublic = new Set([
  "health.ts",
  join("public", "login.ts"),
  join("public", "bling.callback.ts"),
  join("public", "cron.enrichment.ts"),
  join("public", "cron.bling-health.ts"),
  join("public", "cron.bling-sales-export.ts"),
  join("public", "cron.bling-fiscal-sync.ts"),
  join("public", "cron.shipping-enrichment.ts"),
  join("public", "asaas.webhook.ts"),
  join("public", "signup.ts"),
  join("public", "stone.conciliation.webhook.ts"),
]);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const failures = [];
for (const file of files(root).filter((file) => /\.(ts|tsx)$/.test(file))) {
  const rel = relative(root, file);
  const source = readFileSync(file, "utf8");
  if (allowedPublic.has(rel)) continue;
  if (!source.includes("requireApiAuth") && !source.includes("requireSupabaseAuth")) {
    failures.push(`${rel}: rota API sem guard de autenticação`);
  }
}

const mcp = readFileSync(join(process.cwd(), "src", "lib", "mcp", "index.ts"), "utf8");
if (!mcp.includes("auth.oauth.issuer")) {
  failures.push("MCP: OAuth obrigatório foi removido");
}

const login = readFileSync(join(root, "public", "login.ts"), "utf8");
if (!login.includes("ACCOUNT_MAX_FAILURES") || !login.includes("auth_login_attempts")) {
  failures.push("login: rate limit obrigatório ausente");
}

const blingCallback = readFileSync(join(root, "public", "bling.callback.ts"), "utf8");
if (
  !blingCallback.includes("oauth_authorization_states") ||
  !blingCallback.includes("consumed_at") ||
  !blingCallback.includes("expires_at") ||
  !blingCallback.includes("state_hash")
) {
  failures.push("Bling OAuth callback: validação de state de uso único ausente");
}

const blingOauth = readFileSync(join(process.cwd(), "src", "lib", "bling-oauth.functions.ts"), "utf8");
if (
  !blingOauth.includes("requireSupabaseAuth") ||
  !blingOauth.includes("assertAdmin") ||
  !blingOauth.includes("oauth_authorization_states") ||
  !blingOauth.includes("state_hash") ||
  !blingOauth.includes("expires_at")
) {
  failures.push("Bling OAuth start: state persistido/autenticação obrigatória ausente");
}

// Public by design: Vercel/scheduler cron must authenticate with a server-side
// bearer secret. Keep this invariant explicit instead of exempting the route
// without verifying its compensating controls.
const enrichmentCron = readFileSync(join(root, "public", "cron.enrichment.ts"), "utf8");
if (
  !enrichmentCron.includes("isAuthorizedCronToken") ||
  !enrichmentCron.includes("timingSafeEqual") ||
  !enrichmentCron.includes("CRON_SECRET") ||
  !enrichmentCron.includes("verify_enrichment_cron_token") ||
  !enrichmentCron.includes('headers.get("authorization")') ||
  !enrichmentCron.includes("status: 401")
) {
  failures.push("cron enrichment: autenticação server-side obrigatória ausente ou enfraquecida");
}

const blingHealthCron=readFileSync(join(root,"public","cron.bling-health.ts"),"utf8");
if(!blingHealthCron.includes("CRON_SECRET")||!blingHealthCron.includes("timingSafeEqual")||!blingHealthCron.includes("status:401")||!blingHealthCron.includes('request.headers.get("authorization")')) {
 failures.push("cron bling: server-side bearer authentication missing");
}

const blingSalesCron=readFileSync(join(root,"public","cron.bling-sales-export.ts"),"utf8");
if(!blingSalesCron.includes("CRON_SECRET")||!blingSalesCron.includes("timingSafeEqual")||!blingSalesCron.includes("status: 401")||!blingSalesCron.includes('request.headers.get("authorization")')) {
 failures.push("cron bling sales: server-side bearer authentication missing");
}

const blingFiscalCron=readFileSync(join(root,"public","cron.bling-fiscal-sync.ts"),"utf8");
if(!blingFiscalCron.includes("CRON_SECRET")||!blingFiscalCron.includes("timingSafeEqual")||!blingFiscalCron.includes("status:401")||!blingFiscalCron.includes('request.headers.get("authorization")')) {
 failures.push("cron bling fiscal: server-side bearer authentication missing");
}

const shippingCron = readFileSync(join(root, "public", "cron.shipping-enrichment.ts"), "utf8");
if (
  !shippingCron.includes("isAuthorizedCronToken") ||
  !shippingCron.includes("timingSafeEqual") ||
  !shippingCron.includes("CRON_SECRET") ||
  !shippingCron.includes("verify_enrichment_cron_token") ||
  !shippingCron.includes('headers.get("authorization")') ||
  !shippingCron.includes("status: 401")
) {
  failures.push("cron shipping enrichment: autenticação server-side obrigatória ausente ou enfraquecida");
}

const asaasWebhook = readFileSync(join(root, "public", "asaas.webhook.ts"), "utf8");
const asaasPayments = readFileSync(join(process.cwd(), "src", "lib", "asaas-payments.server.ts"), "utf8");
if (
  !asaasWebhook.includes("processAsaasWebhook") ||
  !asaasWebhook.includes("rawBody") ||
  !asaasPayments.includes("asaas-access-token") ||
  !asaasPayments.includes("timingSafeEqual") ||
  !asaasPayments.includes("internal_apply_payment_webhook") ||
  !asaasPayments.includes("Valor Asaas diverge do pedido")
) {
  failures.push("Asaas webhook: autenticação, reconciliação remota ou validação de valor ausente");
}

const signup = readFileSync(join(root, "public", "signup.ts"), "utf8");
if (
  !signup.includes("getPublicAuthRateLimit") ||
  !signup.includes("recordPublicAuthFailure") ||
  !signup.includes("clearPublicAuthFailures") ||
  !signup.includes("SUPABASE_SERVICE_ROLE_KEY") ||
  !signup.includes("Retry-After")
) {
  failures.push("signup: rate limit server-side obrigatório ausente ou enfraquecido");
}

// Public by design: provider webhooks cannot use a user session. Conciliation
// events are bound to a tenant token; transactional events are re-fetched from
// Stone/Pagar.me with the tenant secret before any local payment state changes.
const stoneWebhook = readFileSync(join(root, "public", "stone.conciliation.webhook.ts"), "utf8");
const stonePayments = readFileSync(join(process.cwd(), "src", "lib", "stone-payments.server.ts"), "utf8");
if (
  !stoneWebhook.includes("resolveStoneWebhookTenant") ||
  !stoneWebhook.includes("processStonePaymentWebhook") ||
  !stonePayments.includes("getStoneTransactionContext") ||
  !stonePayments.includes("stoneFetch(context") ||
  !stonePayments.includes("context.providerId !== intent.provider_id") ||
  !stonePayments.includes("remoteAmount !== expectedAmount") ||
  !stonePayments.includes("internal_apply_payment_webhook")
) {
  failures.push("Stone webhook: validação server-side de tenant/provider/valor ausente ou enfraquecida");
}

if (failures.length) {
  console.error("API SECURITY GATE FAILED\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}
console.log("API security invariants OK");
