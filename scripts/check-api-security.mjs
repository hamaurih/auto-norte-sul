import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(process.cwd(), "src", "routes", "api");
const allowedPublic = new Set([
  "health.ts",
  join("public", "login.ts"),
  join("public", "bling.callback.ts"),
  join("public", "bling.webhook.ts"),
  join("public", "cron.bling-order-sync.ts"),
  join("public", "cron.bling-stock-pull.ts"),
  join("public", "cron.enrichment.ts"),
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

function verifyServerCron(path, label) {
  const source = readFileSync(join(root, "public", path), "utf8");
  if (
    !source.includes("isAuthorizedCronToken") ||
    !source.includes("timingSafeEqual") ||
    !source.includes("CRON_SECRET") ||
    !source.includes("verify_enrichment_cron_token") ||
    !source.includes('headers.get("authorization")') ||
    !source.includes("status: 401")
  ) {
    failures.push(`${label}: autenticação server-side obrigatória ausente ou enfraquecida`);
  }
}

// Public by design: Vercel/scheduler cron must authenticate with a server-side
// bearer secret. Keep this invariant explicit instead of exempting the route
// without verifying its compensating controls.
verifyServerCron("cron.enrichment.ts", "cron enrichment");
verifyServerCron("cron.shipping-enrichment.ts", "cron shipping enrichment");
verifyServerCron("cron.bling-order-sync.ts", "cron Bling order sync");
verifyServerCron("cron.bling-stock-pull.ts", "cron Bling stock pull");

// Public by design: Bling calls this endpoint itself. Authentication must be
// HMAC-SHA256 over the exact raw request body using the app client secret.
const blingWebhook = readFileSync(join(root, "public", "bling.webhook.ts"), "utf8");
const blingTransitionStock = readFileSync(join(process.cwd(), "src", "lib", "bling-transition-stock.server.ts"), "utf8");
if (
  !blingWebhook.includes('headers.get("x-bling-signature-256")') ||
  !blingWebhook.includes("request.text()") ||
  !blingWebhook.includes("receiveBlingWebhook") ||
  !blingTransitionStock.includes("createHmac") ||
  !blingTransitionStock.includes("timingSafeEqual") ||
  !blingTransitionStock.includes('update(raw, "utf8")') ||
  !blingTransitionStock.includes("bling_webhook_events") ||
  !blingTransitionStock.includes("eventId")
) {
  failures.push("Bling webhook: HMAC do corpo bruto ou idempotência obrigatória ausente/enfraquecida");
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
