import { createFileRoute } from "@tanstack/react-router";

const OFFICIAL_URL = "https://pzwjbitjersngordgcsh.supabase.co";
const LEGACY_URL = "https://pleuoxzocgoajmymipqi.supabase.co";
const BRIDGE_URL = `${OFFICIAL_URL}/functions/v1/server-admin-bridge`;

function decodeJwtRef(value: string | undefined): string | null {
  if (!value || !value.includes(".")) return null;
  try {
    const payload = value.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return typeof parsed?.ref === "string" ? parsed.ref : null;
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
      headers: keyHeaders(key),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function canReadServiceOnlyTable(key: string | undefined): Promise<boolean> {
  if (!key) return false;
  try {
    const response = await fetch(`${LEGACY_URL}/rest/v1/oauth_authorization_states?select=id&limit=1`, {
      headers: keyHeaders(key),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function bridgeProbe(key: string | undefined): Promise<{ ok: boolean; status: number }> {
  if (!key) return { ok: false, status: 0 };
  try {
    const response = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: {
        "x-cutover-key": key,
        "x-proxy-target": `${OFFICIAL_URL}/rest/v1/tenants?select=id&limit=1`,
        "x-proxy-method": "GET",
        "x-forward-accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: -1 };
  }
}

export const Route = createFileRoute("/api/public/cutover-runtime-check")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const configuredUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
        const keyRef = decodeJwtRef(key);
        const [officialAdminOk, legacyAdminOk, legacyServiceOnlyOk, bridge] = await Promise.all([
          canUseServiceRole(OFFICIAL_URL, key),
          canUseServiceRole(LEGACY_URL, key),
          canReadServiceOnlyTable(key),
          bridgeProbe(key),
        ]);
        return Response.json(
          {
            serviceRoleConfigured: Boolean(key),
            keyProject: keyRef === "pzwjbitjersngordgcsh" ? "official" : keyRef === "pleuoxzocgoajmymipqi" ? "legacy" : keyRef ? "other" : "opaque-or-unknown",
            configuredUrlProject: configuredUrl.includes("pzwjbitjersngordgcsh") ? "official" : configuredUrl.includes("pleuoxzocgoajmymipqi") ? "legacy" : configuredUrl ? "other" : "unset",
            officialAdminOk,
            legacyAdminOk,
            legacyServiceOnlyOk,
            officialBridgeOk: bridge.ok,
            bridgeStatus: bridge.status,
          },
          { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
        );
      },
    },
  },
});
