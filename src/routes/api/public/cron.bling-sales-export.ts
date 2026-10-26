import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/cron/bling-sales-export")({
  server: { handlers: {
    GET: async ({ request }) => {
      const supplied = request.headers.get("authorization")?.replace(/^Bearer /i, "");
      const acceptedSecrets = [
        process.env.CRON_SECRET,
        process.env.BLING_QUEUE_CRON_TOKEN,
      ].filter((value): value is string => Boolean(value));

      const valid = Boolean(supplied && acceptedSecrets.some((secret) =>
        Buffer.byteLength(secret) === Buffer.byteLength(supplied)
        && timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))
      ));

      if (!valid) {
        return Response.json({ ok: false }, { status: 401 });
      }
      const { processBlingPaidSalesQueue } = await import("@/lib/bling-sales-export.server");
      try {
        return Response.json({ ok: true, ...(await processBlingPaidSalesQueue()) });
      } catch {
        return Response.json({ ok: false, error: "Falha ao processar fila Bling" }, { status: 503 });
      }
    },
  } },
});
