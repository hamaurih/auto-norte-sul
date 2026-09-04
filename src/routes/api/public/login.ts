import { createFileRoute } from "@tanstack/react-router";
import { supabasePublishableKey, supabaseUrl } from "@/integrations/supabase/env";

const ACCOUNT_WINDOW_MINUTES = 15;
const ACCOUNT_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 25;

// Transitional credential bridge. The legacy publishable key is public by design;
// no service-role credential from the legacy project is used here. A password is
// only checked there when the same login fails against the official Auth project.
// On success the password is immediately re-established in the official project.
const LEGACY_SUPABASE_URL = "https://pleuoxzocgoajmymipqi.supabase.co";
const LEGACY_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gLG1B4vn7B3xcqd8Dci4Sw_MyEY3PPn";

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

        const pepper = process.env.AUTH_RATE_LIMIT_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!pepper || pepper.length < 32) {
          console.error("[Auth] AUTH_RATE_LIMIT_PEPPER/SUPABASE_SERVICE_ROLE_KEY ausente.");
          return json(503, { error: "Autenticação temporariamente indisponível." });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const attempts = (supabaseAdmin as any).from("auth_login_attempts");
        const ip = clientIp(request);
        const [identifierHash, ipHash] = await Promise.all([
          secureHash(email, pepper),
          secureHash(ip, pepper),
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

        // Password hashes cannot be safely copied through application code during a
        // cross-project Auth cutover. If the official credential is stale, prove the
        // user's existing password against the legacy Auth service, then set that same
        // password through the official Admin API and retry the official login.
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
                const { data: officialUserResult, error: officialUserError } = await (supabaseAdmin as any)
                  .auth.admin.getUserById(legacyUserId);
                const officialEmail = typeof officialUserResult?.user?.email === "string"
                  ? officialUserResult.user.email.trim().toLowerCase()
                  : "";

                if (!officialUserError && officialEmail === email) {
                  const { error: updateError } = await (supabaseAdmin as any)
                    .auth.admin.updateUserById(legacyUserId, { password });

                  if (!updateError) {
                    authResult = await passwordGrant(supabaseUrl(), supabasePublishableKey(), email, password);
                    if (validSession(authResult)) {
                      console.info("[Auth cutover] Credential migrated to official project.");
                    }
                  } else {
                    console.error("[Auth cutover] Failed to update official credential:", updateError.message);
                  }
                } else {
                  console.error("[Auth cutover] Official identity validation failed.");
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

        // A successful login resets the account failure window. IP failures are
        // intentionally retained briefly so distributed account probing is still limited.
        await (supabaseAdmin as any)
          .from("auth_login_attempts")
          .delete()
          .eq("identifier_hash", identifierHash)
          .eq("success", false);

        // Opportunistic retention cleanup; no raw e-mail/IP is ever persisted.
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
