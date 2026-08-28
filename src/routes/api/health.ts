/**
 * ARC-15: Health check endpoint — /api/health
 * Retorna status do sistema para monitoramento (UptimeRobot, BetterStack, etc.)
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { supabasePublishableKey, supabaseUrl } from "@/integrations/supabase/env";

export const APIRoute = createAPIFileRoute("/api/health")({
  GET: async () => {
    const start = Date.now();
    let dbOk = false;
    let dbLatencyMs = 0;

    try {
      const SUPABASE_URL = process.env.SUPABASE_URL || supabaseUrl;
      const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || supabasePublishableKey;
      if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
        const t0 = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${SUPABASE_URL}/rest/v1/brands?select=id&limit=1`, {
          headers: {
            apikey:        SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        dbLatencyMs = Date.now() - t0;
        dbOk = res.ok;
      }
    } catch {
      dbOk = false;
    }

    const status = dbOk ? "ok" : "degraded";
    const body = {
      status,
      timestamp:    new Date().toISOString(),
      uptime_ms:    Date.now() - start,
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
});
