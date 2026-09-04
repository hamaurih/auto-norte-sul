import { createFileRoute } from "@tanstack/react-router";

const OFFICIAL_URL = "https://pzwjbitjersngordgcsh.supabase.co";
const LEGACY_URL = "https://pleuoxzocgoajmymipqi.supabase.co";

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

async function canUseServiceRole(baseUrl: string, key: string | undefined): Promise<boolean> {
  if (!key) return false;
  const headers = new Headers({ apikey: key });
  if (!key.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${key}`);
  try {
    const response = await fetch(`${baseUrl}/rest/v1/tenants?select=id&limit=1`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/cutover-runtime-check")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const configuredUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
        const keyRef = decodeJwtRef(key);
        const [officialAdminOk, legacyAdminOk] = await Promise.all([
          canUseServiceRole(OFFICIAL_URL, key),
          canUseServiceRole(LEGACY_URL, key),
        ]);
        return Response.json(
          {
            serviceRoleConfigured: Boolean(key),
            keyProject: keyRef === "pzwjbitjersngordgcsh" ? "official" : keyRef === "pleuoxzocgoajmymipqi" ? "legacy" : keyRef ? "other" : "opaque-or-unknown",
            configuredUrlProject: configuredUrl.includes("pzwjbitjersngordgcsh") ? "official" : configuredUrl.includes("pleuoxzocgoajmymipqi") ? "legacy" : configuredUrl ? "other" : "unset",
            officialAdminOk,
            legacyAdminOk,
          },
          { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
        );
      },
    },
  },
});
