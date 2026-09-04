import { createFileRoute } from "@tanstack/react-router";

const BRIDGE_URL = "https://pzwjbitjersngordgcsh.supabase.co/functions/v1/server-admin-bridge";

export const Route = createFileRoute("/api/public/auth-admin-bridge-check")({
  server: {
    handlers: {
      GET: async () => {
        const credential = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AUTH_RATE_LIMIT_PEPPER || "";
        if (credential.length < 32) return Response.json({ ok: false, stage: "credential" }, { status: 503 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: membership, error } = await (supabaseAdmin as any)
          .from("tenant_memberships")
          .select("user_id")
          .eq("role", "owner")
          .eq("active", true)
          .limit(1)
          .maybeSingle();
        if (error || !membership?.user_id) return Response.json({ ok: false, stage: "membership" }, { status: 500 });

        const response = await fetch(BRIDGE_URL, {
          method: "POST",
          headers: {
            "x-cutover-key": credential,
            "x-proxy-path": `/auth/v1/admin/users/${encodeURIComponent(String(membership.user_id))}`,
            "x-proxy-method": "GET",
            "x-forward-accept": "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        const body: any = await response.json().catch(() => ({}));
        const user = body?.user && typeof body.user === "object" ? body.user : body;
        return Response.json(
          { ok: response.ok && Boolean(user?.id), upstreamStatus: response.status, identityFound: Boolean(user?.id) },
          { status: response.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
