/**
 * Public liveness endpoint for uptime monitoring.
 * Intentionally exposes no credentials, environment flags, version, tenant data or internals.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabasePublishableKey, supabaseUrl } from "@/integrations/supabase/env";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        let dbOk = false;
        try {
          const url = supabaseUrl();
          const key = supabasePublishableKey();
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2500);
          try {
            const res = await fetch(`${url}/rest/v1/brands?select=id&limit=1`, {
              headers: { apikey: key },
              signal: controller.signal,
            });
            dbOk = res.ok;
          } finally {
            clearTimeout(timeout);
          }
        } catch {
          dbOk = false;
        }

        return new Response(
          JSON.stringify({ status: dbOk ? "ok" : "degraded" }),
          {
            status: dbOk ? 200 : 503,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store, max-age=0",
              "X-Content-Type-Options": "nosniff",
              "Referrer-Policy": "no-referrer",
            },
          },
        );
      },
    },
  },
});
