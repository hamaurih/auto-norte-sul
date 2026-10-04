import { createFileRoute } from "@tanstack/react-router";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
}

export const Route = createFileRoute("/api/public/asaas/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { processAsaasWebhook } = await import("@/lib/asaas-payments.server");
          const result = await processAsaasWebhook(supabaseAdmin as any, rawBody, request.headers);
          return json(200, { ok: true, ignored: Boolean(result.ignored), status: result.normalizedStatus ?? null });
        } catch (error: any) {
          console.error("[Asaas webhook]", String(error?.message ?? error).slice(0, 500));
          return json(500, { error: "asaas_webhook_failed" });
        }
      },
    },
  },
});
