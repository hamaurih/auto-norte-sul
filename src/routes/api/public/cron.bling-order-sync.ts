/**
 * Worker interno da fase híbrida Norte Sul -> Bling.
 * Não faz chamadas ao Bling dentro da transação do checkout: consome a outbox
 * criada pelo banco e mantém pedido, estoque, financeiro e NF-e rastreáveis.
 */
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
  if (!await isAuthorizedCronToken(provided)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  try {
    const { runBlingOrderSyncWorker } = await import("@/lib/bling-order-sync.server");
    const result = await runBlingOrderSyncWorker(5);
    return Response.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Erro inesperado no worker Bling" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/bling-order-sync")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
