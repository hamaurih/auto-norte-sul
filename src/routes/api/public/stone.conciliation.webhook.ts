import { createFileRoute } from "@tanstack/react-router";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/public/stone/conciliation/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return json(400, { error: "invalid_json" });
        }

        // Stone calls the URL before saving the webhook and requires a 2xx in 3 seconds.
        if (payload?.type === "validation_notification") return json(200, { ok: true });

        const token = new URL(request.url).searchParams.get("token") ?? "";
        if (token.length < 32 || token.length > 256) return json(401, { error: "unauthorized" });
        if (
          payload?.type !== "pix" ||
          typeof payload?.url !== "string" ||
          typeof payload?.document !== "string" ||
          typeof payload?.referenceDate !== "string"
        ) {
          return json(400, { error: "invalid_notification" });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { enqueueStonePixNotification, resolveStoneWebhookTenant } = await import(
            "@/lib/stone-conciliation.server"
          );
          const owner = await resolveStoneWebhookTenant(supabaseAdmin as any, token);
          if (!owner) return json(401, { error: "unauthorized" });
          await enqueueStonePixNotification(supabaseAdmin as any, owner, payload);
          return json(200, { ok: true });
        } catch (error: any) {
          console.error("[Stone conciliation webhook]", String(error?.message ?? error).slice(0, 500));
          return json(400, { error: "notification_rejected" });
        }
      },
    },
  },
});
