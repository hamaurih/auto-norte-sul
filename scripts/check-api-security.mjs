import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(process.cwd(), "src", "routes", "api");
const allowedPublic = new Set([
  "health.ts",
  join("public", "login.ts"),
  join("public", "bling.callback.ts"),
  join("public", "cron.enrichment.ts"),
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
