import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/cron/bling-fiscal-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        const provided = request.headers.get("authorization")?.replace(/^Bearer /i, "");
        if (
          !expected ||
          !provided ||
          Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
          !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
        ) {
          return Response.json({ ok:false }, { status:401 });
        }

        const { syncBlingFiscalTraceWorker } = await import("@/lib/fiscal-bling.functions");
        const report = await syncBlingFiscalTraceWorker(20);
        return Response.json(
          { ok: report.failed === 0, ...report },
          { status: report.failed === 0 ? 200 : 207 },
        );
      },
    },
  },
});
