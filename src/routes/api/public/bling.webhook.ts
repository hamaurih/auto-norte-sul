import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request) {
  const signature = request.headers.get("x-bling-signature-256") ?? "";
  const raw = await request.text();
  try {
    const { receiveBlingWebhook } = await import("@/lib/bling-transition-stock.server");
    const result = await receiveBlingWebhook(raw, signature);
    return Response.json(result, { status: result.status });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Erro inesperado no webhook Bling" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/bling/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
