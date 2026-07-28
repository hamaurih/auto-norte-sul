/**
 * Bling OAuth 2.0 callback.
 * Exchanges the authorization code for tokens and stores them in bling_config.
 * Public route — Bling redirects the browser here after the user consents.
 */
import { createFileRoute } from "@tanstack/react-router";

const TOKEN_URL = "https://www.bling.com.br/Api/v3/oauth/token";

function html(status: number, title: string, body: string) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:system-ui;margin:0;background:#0a0a0a;color:#f4f4f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .box{max-width:520px;padding:32px;border:1px solid #27272a;border-radius:12px;background:#111}
    h1{margin:0 0 12px;font-size:20px}p{margin:0 0 16px;color:#a1a1aa;line-height:1.5}
    a{color:#60a5fa;text-decoration:none}</style></head>
    <body><div class="box"><h1>${title}</h1><p>${body}</p>
    <p><a href="/admin/ecossistema/bling">← Voltar ao painel Bling</a></p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/bling/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) return html(400, "Autorização negada", `O Bling retornou: <code>${error}</code>`);
        if (!code) return html(400, "Código ausente", "O Bling não enviou um authorization_code.");

        const clientId = process.env.BLING_CLIENT_ID;
        const clientSecret = process.env.BLING_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return html(500, "Secrets não configurados", "Configure BLING_CLIENT_ID e BLING_CLIENT_SECRET no backend.");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: cfg } = await supabaseAdmin.from("bling_config").select("id,redirect_uri").limit(1).single();
        const redirectUri = cfg?.redirect_uri ?? `${url.origin}/api/public/bling/callback`;

        const basic = btoa(`${clientId}:${clientSecret}`);
        try {
          const tokRes = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
              Authorization: `Basic ${basic}`,
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
            }).toString(),
          });
          const json: any = await tokRes.json();
          if (!tokRes.ok || !json.access_token) {
            await supabaseAdmin.from("bling_sync_logs").insert({
              entity: "produto",
              action: "oauth_callback",
              status: "erro",
              message: `Falha ao trocar código: ${JSON.stringify(json).slice(0, 400)}`,
            });
            return html(502, "Falha na autorização", "O Bling não devolveu um access_token válido. Consulte os logs.");
          }

          const expiresAt = new Date(Date.now() + (json.expires_in ?? 21600) * 1000).toISOString();
          await supabaseAdmin
            .from("bling_config")
            .update({
              client_id: clientId,
              access_token: json.access_token,
              refresh_token: json.refresh_token,
              expires_at: expiresAt,
              scope: json.scope ?? null,
              last_authorized_at: new Date().toISOString(),
              last_test_status: "sucesso",
              updated_at: new Date().toISOString(),
            })
            .eq("id", cfg!.id);

          await supabaseAdmin.from("bling_sync_logs").insert({
            entity: "produto",
            action: "oauth_callback",
            status: "sucesso",
            message: "Autorização OAuth 2.0 concluída com sucesso.",
          });

          return html(200, "Conectado ao Bling ✅", "Sua loja está autorizada. Você pode fechar esta aba.");
        } catch (e: any) {
          await supabaseAdmin.from("bling_sync_logs").insert({
            entity: "produto",
            action: "oauth_callback",
            status: "erro",
            message: `Exceção: ${String(e?.message ?? e).slice(0, 400)}`,
          });
          return html(500, "Erro inesperado", "Não foi possível concluir a autorização.");
        }
      },
    },
  },
});
