import { createFileRoute } from "@tanstack/react-router";

const OFFICIAL_URL = "https://pzwjbitjersngordgcsh.supabase.co";
const LEGACY_URL = "https://pleuoxzocgoajmymipqi.supabase.co";
const BRIDGE_URL = `${OFFICIAL_URL}/functions/v1/server-admin-bridge`;

async function bridgeProbe(key: string | undefined): Promise<{ ok: boolean; status: number }> {
  if (!key || key.length < 32) return { ok: false, status: 0 };
  try {
    const response = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: {
        "x-cutover-key": key,
        "x-proxy-path": "/rest/v1/products?select=id&deleted_at=is.null&limit=1",
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

async function adminClientProbe(): Promise<{ ok: boolean; currentProducts: number | null; error?: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await (supabaseAdmin as any)
      .from("products")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);
    return {
      ok: !result.error && typeof result.count === "number",
      currentProducts: typeof result.count === "number" ? result.count : null,
      error: result.error?.message,
    };
  } catch (error) {
    return { ok: false, currentProducts: null, error: error instanceof Error ? error.message : "unknown" };
  }
}

export const Route = createFileRoute("/api/public/cutover-runtime-check")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AUTH_RATE_LIMIT_PEPPER;
        const configuredUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
        const [bridge, admin] = await Promise.all([bridgeProbe(key), adminClientProbe()]);

        return Response.json({
          officialProject: "pzwjbitjersngordgcsh",
          configuredEnvProject: configuredUrl.includes("pzwjbitjersngordgcsh")
            ? "official"
            : configuredUrl.includes("pleuoxzocgoajmymipqi")
              ? "legacy"
              : configuredUrl
                ? "other"
                : "unset",
          legacyProject: LEGACY_URL.includes("pleuoxzocgoajmymipqi") ? "pleuoxzocgoajmymipqi" : null,
          officialBridgeOk: bridge.ok,
          bridgeStatus: bridge.status,
          officialAdminClientOk: admin.ok,
          currentProducts: admin.currentProducts,
          adminError: admin.error || null,
        }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      },
    },
  },
});
