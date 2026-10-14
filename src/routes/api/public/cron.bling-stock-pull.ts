import { createFileRoute } from "@tanstack/react-router";

async function safeEqual(a: string, b: string) {
  if (!a || !b) return false;
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

async function isAuthorizedCronToken(provided: string): Promise<boolean> {
  if (!provided) return false;
  const vercelSecret = process.env["CRON_SECRET"];
  if (vercelSecret && await safeEqual(provided, vercelSecret)) return true;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("verify_enrichment_cron_token", { p_token: provided });
    return !error && data === true;
  } catch {
    return false;
  }
}

async function handle(request: Request) {
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!await isAuthorizedCronToken(provided)) return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });

  try {
    const { runBlingStockPull } = await import("@/lib/bling-transition-stock.server");
    const result = await runBlingStockPull();
    return Response.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Erro inesperado na reconciliação de estoque Bling" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/bling-stock-pull")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
