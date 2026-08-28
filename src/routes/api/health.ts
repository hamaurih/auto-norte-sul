/**
 * ARC-15: Health check endpoint — /api/health
 * Retorna status do sistema para monitoramento (UptimeRobot, BetterStack, etc.)
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabasePublishableKey, supabaseUrl } from "@/integrations/supabase/env";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const start = Date.now();
        let dbOk = false;
        let dbLatencyMs = 0;

        try {
          const url = process.env.SUPABASE_URL || supabaseUrl;
          const key = process.env.SUPABASE_PUBLISHABLE_KEY || supabasePublishableKey;

          if (url && key) {
            const t0 = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);

            try {
              const res = await fetch(`${url}/rest/v1/brands?select=id&limit=1`, {
                headers: {
                  apikey: key,
                  Authorization: `Bearer ${key}`,
                },
                signal: controller.signal,
              });
              dbLatencyMs = Date.now() - t0;
              dbOk = res.ok;
            } finally {
              clearTimeout(timeout);
            }
          }
        } catch {
          dbOk = false;
        }

        const body = {
          status: dbOk ? "ok" : "degraded",
          timestamp: new Date().toISOString(),
          uptime_ms: Date.now() - start,
          checks: {
            database: { ok: dbOk, latency_ms: dbLatencyMs },
            server_actions: { configured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) },
          },
          version: process.env.npm_package_version ?? "unknown",
        };

        return new Response(JSON.stringify(body), {
          status: dbOk ? 200 : 503,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
