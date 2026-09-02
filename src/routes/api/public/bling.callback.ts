/**
 * Bling OAuth 2.0 callback.
 * Public by protocol, protected by a short-lived one-time OAuth state bound to
 * the exact tenant, configuration and redirect URI that initiated authorization.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getBlingCredentials } from "@/lib/bling.functions";

const TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";
const OAUTH_STATE_COOKIE = "__Host-bling-oauth-state";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function html(status: number, title: string, body: string, clearStateCookie = false) {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  });
  if (clearStateCookie) {
    headers.set(
      "Set-Cookie",
      `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    );
  }
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${safeTitle}</title>
    <style>body{font-family:system-ui;margin:0;background:#0a0a0a;color:#f4f4f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .box{max-width:520px;padding:32px;border:1px solid #27272a;border-radius:12px;background:#111}
    h1{margin:0 0 12px;font-size:20px}p{margin:0 0 16px;color:#a1a1aa;line-height:1.5}
    a{color:#60a5fa;text-decoration:none}</style></head>
    <body><div class="box"><h1>${safeTitle}</h1><p>${safeBody}</p>
    <p><a href="/admin/ecossistema/bling">← Voltar ao painel Bling</a></p></div></body></html>`,
    { status, headers },
  );
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return rawValue.join("=");
      }
    }
  }
  return null;
}

async function hashState(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/bling/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const cookieState = readCookie(request, OAUTH_STATE_COOKIE);
        const state = returnedState || cookieState;
        const oauthError = url.searchParams.get("error");

        if (!state || state.length > 512) {
          return html(400, "Autorização inválida", "O estado de segurança OAuth está ausente ou é inválido.");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const stateHash = await hashState(state);
        const now = new Date().toISOString();

        const { data: stateRow, error: stateError } = await (supabaseAdmin as any)
          .from("oauth_authorization_states")
          .update({ consumed_at: now })
          .eq("state_hash", stateHash)
          .eq("provider", "bling")
          .is("consumed_at", null)
          .gt("expires_at", now)
          .select("tenant_id,config_id,redirect_uri,actor_user_id")
          .maybeSingle();

        if (
          stateError ||
          !stateRow?.tenant_id ||
          !stateRow?.config_id ||
          !stateRow?.redirect_uri
        ) {
          return html(
            400,
            "Autorização expirada",
            "Esta autorização é inválida, já foi utilizada ou expirou. Inicie uma nova conexão pelo painel.",
            !returnedState && Boolean(cookieState),
          );
        }

        if (oauthError) {
          return html(400, "Autorização negada", `O Bling retornou o erro: ${oauthError}`, true);
        }
        if (!code || code.length > 4096) {
          return html(400, "Código ausente", "O Bling não enviou um authorization_code válido.", true);
        }

        const { data: cfg, error: cfgError } = await (supabaseAdmin as any)
          .from("bling_config")
          .select("id,tenant_id,client_id,client_secret_encrypted")
          .eq("tenant_id", stateRow.tenant_id)
          .eq("id", stateRow.config_id)
          .maybeSingle();
        if (cfgError || !cfg?.id) {
          return html(400, "Configuração inválida", "A configuração associada a esta autorização não existe mais.", true);
        }

        const { clientId, clientSecret } = await getBlingCredentials(supabaseAdmin, stateRow.tenant_id, cfg);
        if (!clientId || !clientSecret) {
          return html(500, "Configuração incompleta", "As credenciais do Bling não estão configuradas no backend.", true);
        }

        const log = async (status: "sucesso" | "erro", message: string) => {
          await (supabaseAdmin as any).from("bling_sync_logs").insert({
            tenant_id: stateRow.tenant_id,
            entity: "produto",
            action: "oauth_callback",
            status,
            message,
          });
        };

        const basic = btoa(`${clientId}:${clientSecret}`);
        try {
          const tokRes = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
              Authorization: `Basic ${basic}`,
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
              "enable-jwt": "1",
            },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: stateRow.redirect_uri,
            }).toString(),
          });
          const tokenPayload: any = await tokRes.json().catch(() => ({}));
          if (!tokRes.ok || !tokenPayload.access_token) {
            await log("erro", `Falha ao trocar authorization_code (HTTP ${tokRes.status}).`);
            return html(
              502,
              "Falha na autorização",
              "O Bling não devolveu um access_token válido. Inicie uma nova autorização pelo painel.",
              true,
            );
          }

          const expiresAt = new Date(Date.now() + (tokenPayload.expires_in ?? 21600) * 1000).toISOString();
          const { error: updateError } = await (supabaseAdmin as any)
            .from("bling_config")
            .update({
              client_id: clientId,
              access_token: tokenPayload.access_token,
              refresh_token: tokenPayload.refresh_token,
              expires_at: expiresAt,
              scope: tokenPayload.scope ?? null,
              redirect_uri: stateRow.redirect_uri,
              last_authorized_at: new Date().toISOString(),
              last_test_status: "sucesso",
              updated_at: new Date().toISOString(),
            })
            .eq("tenant_id", stateRow.tenant_id)
            .eq("id", cfg.id);
          if (updateError) throw updateError;

          await log(
            "sucesso",
            returnedState
              ? "Autorização OAuth 2.0 concluída com state retornado pelo Bling."
              : "Autorização OAuth 2.0 concluída com state recuperado do cookie seguro de origem.",
          );
          return html(200, "Conectado ao Bling", "Sua loja está autorizada. Você pode fechar esta aba.", true);
        } catch (error: any) {
          await log("erro", `Exceção no callback OAuth: ${String(error?.message ?? error).slice(0, 240)}`);
          return html(500, "Erro inesperado", "Não foi possível concluir a autorização. Inicie uma nova tentativa pelo painel.", true);
        }
      },
    },
  },
});
