import { createFileRoute } from "@tanstack/react-router";

const OFFICIAL_URL = "https://pzwjbitjersngordgcsh.supabase.co";
const LEGACY_URL = "https://pleuoxzocgoajmymipqi.supabase.co";

function decodeJwt(value: string | undefined): Record<string, unknown> | null {
  if (!value || !value.includes(".")) return null;
  try {
    const payload = value.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function keyHeaders(key: string): Headers {
  const headers = new Headers({ apikey: key });
  if (!key.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${key}`);
  return headers;
}

async function canUseServiceRole(baseUrl: string, key: string | undefined): Promise<boolean> {
  if (!key) return false;
  try {
    const response = await fetch(`${baseUrl}/rest/v1/tenants?select=id&limit=1`, {
      headers: keyHeaders(key), signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch { return false; }
}

async function canReadServiceOnlyTable(key: string | undefined): Promise<boolean> {
  if (!key) return false;
  try {
    const response = await fetch(`${LEGACY_URL}/rest/v1/oauth_authorization_states?select=id&limit=1`, {
      headers: keyHeaders(key), signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch { return false; }
}

export const Route = createFileRoute("/api/public/cutover-runtime-check")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const configuredUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
        const keyClaims = decodeJwt(key);
        const oidcClaims = decodeJwt(process.env.VERCEL_OIDC_TOKEN);
        const [officialAdminOk, legacyAdminOk, legacyServiceOnlyOk] = await Promise.all([
          canUseServiceRole(OFFICIAL_URL, key), canUseServiceRole(LEGACY_URL, key), canReadServiceOnlyTable(key),
        ]);
        return Response.json({
          serviceRoleConfigured: Boolean(key),
          keyProject: keyClaims?.ref === "pzwjbitjersngordgcsh" ? "official" : keyClaims?.ref === "pleuoxzocgoajmymipqi" ? "legacy" : keyClaims?.ref ? "other" : "opaque-or-unknown",
          configuredUrlProject: configuredUrl.includes("pzwjbitjersngordgcsh") ? "official" : configuredUrl.includes("pleuoxzocgoajmymipqi") ? "legacy" : configuredUrl ? "other" : "unset",
          officialAdminOk, legacyAdminOk, legacyServiceOnlyOk,
          oidcConfigured: Boolean(process.env.VERCEL_OIDC_TOKEN),
          oidc: oidcClaims ? { iss: oidcClaims.iss, aud: oidcClaims.aud, sub: oidcClaims.sub, environment: oidcClaims.environment, project: oidcClaims.project } : null,
        }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      },
    },
  },
});
