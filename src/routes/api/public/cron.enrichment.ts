/**
 * Endpoint interno de processamento em lote do enriquecimento de catálogo.
 *
 * Chamado pelo Vercel Cron (a cada 10 minutos) com
 * `Authorization: Bearer ${CRON_SECRET}` — o header é adicionado
 * automaticamente pela Vercel quando a variável CRON_SECRET existe no
 * projeto. Sem o segredo configurado o endpoint responde 503 e nunca
 * processa nada (fail closed). A comparação usa digest de tempo constante.
 */
import { createFileRoute } from "@tanstack/react-router";

async function handleCronRequest(request: Request): Promise<Response> {
  const secret = process.env["CRON_SECRET"];
  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET não configurado no servidor; automação desativada" },
      { status: 503 },
    );
  }

  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!provided || !timingSafeEqual(digest(provided), digest(secret))) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  try {
    const { runEnrichmentAutopilot } = await import("@/lib/product-enrichment-autopilot.server");
    const result = await runEnrichmentAutopilot({ trigger: "cron" });
    return Response.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Erro inesperado no worker" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/enrichment")({
  server: {
    handlers: {
      GET: ({ request }) => handleCronRequest(request),
      POST: ({ request }) => handleCronRequest(request),
    },
  },
});
