import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/cron/bling-sales-export")({
  server: { handlers: {
    GET: async ({ request }) => {
      const supplied = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (!supplied) return Response.json({ ok: false }, { status: 401 });

      let valid = false;
      const vercelSecret = process.env["CRON_SECRET"];
      if (vercelSecret) {
        const { createHash, timingSafeEqual } = await import("node:crypto");
        const digest = (value: string) => createHash("sha256").update(value).digest();
        valid = timingSafeEqual(digest(vercelSecret), digest(supplied));
      }

      if (!valid) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await (supabaseAdmin as any).rpc("verify_enrichment_cron_token", {
            p_token: supplied,
          });
          valid = !error && data === true;
        } catch {
          valid = false;
        }
      }

      if (!valid) return Response.json({ ok: false }, { status: 401 });
      const { processBlingPaidSalesQueue } = await import("@/lib/bling-sales-export.server");
      try {
        return Response.json({ ok: true, ...(await processBlingPaidSalesQueue()) });
      } catch {
        return Response.json({ ok: false, error: "Falha ao processar fila Bling" }, { status: 503 });
      }
    },
  } },
});
