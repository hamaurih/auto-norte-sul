import { createFileRoute } from "@tanstack/react-router";
import { supabasePublishableKey, supabaseUrl } from "@/integrations/supabase/env";

const ACCOUNT_WINDOW_MINUTES = 15;
const ACCOUNT_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 25;

const LEGACY_SUPABASE_URL = "https://pleuoxzocgoajmymipqi.supabase.co";
const LEGACY_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gLG1B4vn7B3xcqd8Dci4Sw_MyEY3PPn";
const OFFICIAL_ADMIN_BRIDGE_URL = "https://pzwjbitjersngordgcsh.supabase.co/functions/v1/server-admin-bridge";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function secureHash(value: string, pepper: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${pepper}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordGrant(url: string, publishableKey: string, email: string, password: string) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, any>;
  return { response, body };
}

function validSession(result: { response: Response; body: Record<string, any> }) {
  return result.response.ok && Boolean(result.body.access_token) && Boolean(result.body.refresh_token);
}

async function officialAdminBridge(
  credential: string,
  path: string,
  method: "GET" | "PATCH",
  body?: Record<string, unknown>,
) {
  const headers = new Headers({
    "x-cutover-key": credential,
    "x-proxy-path": path,
    "x-proxy-method": method,
    "x-forward-accept": "application/json",
  });
  if (body) headers.set("x-forward-content-type", "application/json");

  const response = await fetch(OFFICIAL_ADMIN_BRIDGE_URL, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  return { response, body: payload };
}

function bridgedUser(payload: Record<string, any>) {
  return payload?.user && typeof payload.user === "object" ? payload.user : payload;
}

export const Route = createFileRoute("/api/public/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const origin = request.headers.get("origin");
        if (origin && origin !== requestUrl.origin) {
          return json(403, { error: "Requisição não autorizada." });
        }

        let input: unknown;
        try {
          input = await request.json();
        } catch {
          return json(400, { error: "Requisição inválida." });
        }

        const body = input as { email?: unknown; password?: unknown };
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        if (!email || email.length > 320 || !password || password.length > 1024) {
          return json(400, { error: "Credenciais inválidas." });
        }

        const serverCredential = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AUTH_RATE_LIMIT_PEPPER;
        if (!serverCredential || serverCredential.length < 32) {
          console.error("[Auth] server credential ausente.");
          return json(503, { error: "Autenticação temporariamente indisponível." });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const attempts = (supabaseAdmin as any).from("auth_login_attempts");
        const ip = clientIp(request);
        const [identifierHash, ipHash] = await Promise.all([
          secureHash(email, serverCredential),
          secureHash(ip, serverCredential),
        ]);
        const since = new Date(Date.now() - ACCOUNT_WINDOW_MINUTES * 60_000).toISOString();

        const [accountResult, ipResult] = await Promise.all([
          attempts
            .select("id,created_at", { count: "exact" })
            .eq("identifier_hash", identifierHash)
            .eq("success", false)
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(1),
          (supabaseAdmin as any)
            .from("auth_login_attempts")
            .select("id,created_at", { count: "exact" })
            .eq("ip_hash", ipHash)
            .eq("success", false)
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(1),
        ]);

        const accountFailures = accountResult.count ?? 0;
        const ipFailures = ipResult.count ?? 0;
        if (accountFailures >= ACCOUNT_MAX_FAILURES || ipFailures >= IP_MAX_FAILURES) {
          const newest = accountResult.data?.[0]?.created_at || ipResult.data?.[0]?.created_at;
          const retryAfter = newest
            ? Math.max(60, Math.ceil((new Date(newest).getTime() + ACCOUNT_WINDOW_MINUTES * 60_000 - Date.now()) / 1000))
            : ACCOUNT_WINDOW_MINUTES * 60;
          return new Response(
            JSON.stringify({
              error: "Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente.",
              retry_after_seconds: retryAfter,
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store, max-age=0",
                "Retry-After": String(retryAfter),
                "X-Content-Type-Options": "nosniff",
              },
            },
          );
        }

        let authResult = await passwordGrant(supabaseUrl(), supabasePublishableKey(), email, password);

        if (!validSession(authResult)) {
          try {
            const legacyResult = await passwordGrant(
              LEGACY_SUPABASE_URL,
              LEGACY_SUPABASE_PUBLISHABLE_KEY,
              email,
              password,
            );

            if (validSession(legacyResult)) {
              const legacyUserId = typeof legacyResult.body.user?.id === "string" ? legacyResult.body.user.id : "";
              const legacyEmail = typeof legacyResult.body.user?.email === "string"
                ? legacyResult.body.user.email.trim().toLowerCase()
                : "";

              if (legacyUserId && legacyEmail === email) {
                const getResult = await officialAdminBridge(
                  serverCredential,
                  `/auth/v1/admin/users/${encodeURIComponent(legacyUserId)}`,
                  "GET",
                );
                const officialUser = bridgedUser(getResult.body);
                const officialEmail = typeof officialUser?.email === "string"
                  ? officialUser.email.trim().toLowerCase()
                  : "";

                if (getResult.response.ok && officialEmail === email) {
                  const updateResult = await officialAdminBridge(
                    serverCredential,
                    `/auth/v1/admin/users/${encodeURIComponent(legacyUserId)}`,
                    "PATCH",
                    { password },
                  );

                  if (updateResult.response.ok) {
                    authResult = await passwordGrant(supabaseUrl(), supabasePublishableKey(), email, password);
                    if (validSession(authResult)) {
                      console.info("[Auth cutover] Credential migrated to official project.");
                    }
                  } else {
                    console.error("[Auth cutover] Official credential update failed.", updateResult.response.status);
                  }
                } else {
                  console.error("[Auth cutover] Official identity validation failed.", getResult.response.status);
                }
              }
            }
          } catch (migrationError) {
            console.error(
              "[Auth cutover] Legacy credential validation failed safely:",
              migrationError instanceof Error ? migrationError.message : "unknown",
            );
          }
        }

        if (!validSession(authResult)) {
          await (supabaseAdmin as any).from("auth_login_attempts").insert({
            identifier_hash: identifierHash,
            ip_hash: ipHash,
            success: false,
          });
          return json(401, { error: "E-mail ou senha inválidos." });
        }

        await (supabaseAdmin as any)
          .from("auth_login_attempts")
          .delete()
          .eq("identifier_hash", identifierHash)
          .eq("success", false);

        const retentionCutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
        void (supabaseAdmin as any)
          .from("auth_login_attempts")
          .delete()
          .lt("created_at", retentionCutoff);

        return json(200, {
          access_token: authResult.body.access_token,
          refresh_token: authResult.body.refresh_token,
          expires_in: authResult.body.expires_in,
          token_type: authResult.body.token_type,
        });
      },
    },
  },
});
