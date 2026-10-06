import { createFileRoute } from "@tanstack/react-router";
import { supabaseUrl, supabasePublishableKey } from "@/integrations/supabase/env";
import { DEFAULT_TENANT_SLUG } from "@/integrations/supabase/tenant";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 120;
}

export const Route = createFileRoute("/api/public/signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const origin = request.headers.get("origin");
        if (origin && origin !== requestUrl.origin) return json(403, { error: "Requisição não autorizada." });

        let input: { name?: unknown; email?: unknown; password?: unknown };
        try { input = await request.json(); } catch { return json(400, { error: "Dados de cadastro inválidos." }); }
        const name = validName(input.name) ? input.name.trim() : "";
        const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
        const password = typeof input.password === "string" ? input.password : "";
        if (!name) return json(400, { error: "Informe seu nome completo." });
        if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) return json(400, { error: "Informe um e-mail válido." });
        if (password.length < 6 || password.length > 128) return json(400, { error: "Use uma senha de 6 a 128 caracteres." });

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: name },
          });
          if (createError || !created.user) {
            const message = createError?.message ?? "Não foi possível criar a conta.";
            if (/already been registered|already registered/i.test(message)) return json(409, { error: "Este e-mail já possui uma conta. Tente entrar." });
            if (/weak and easy to guess|password.*weak/i.test(message)) return json(422, { error: "Esta senha é muito comum ou já foi exposta. Escolha outra para proteger sua conta." });
            console.error("[Signup] create user failed", message);
            return json(400, { error: "Não foi possível criar a conta. Revise os dados e tente novamente." });
          }

          // A conta criada na vitrine é vinculada à carteira do tenant atual.
          // Falhas de cadastro comercial não impedem a criação da conta de compra.
          const { data: storefront } = await supabaseAdmin
            .from("tenant_storefronts")
            .select("tenant_id")
            .eq("slug", DEFAULT_TENANT_SLUG)
            .maybeSingle();
          const tenantId = storefront?.tenant_id as string | undefined;
          if (tenantId) {
            const { data: existing } = await supabaseAdmin
              .from("customers")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("email", email)
              .maybeSingle();
            const result = existing?.id
              ? await supabaseAdmin.from("customers").update({ user_id: created.user.id, name, active: true }).eq("id", existing.id)
              : await supabaseAdmin.from("customers").insert({ tenant_id: tenantId, user_id: created.user.id, name, email, active: true });
            if (result.error) console.error("[Signup] customer link failed", result.error.message);
          }

          const login = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
            method: "POST",
            headers: { apikey: supabasePublishableKey(), "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ email, password }),
            signal: AbortSignal.timeout(10_000),
          });
          const session = await login.json().catch(() => ({}));
          if (!login.ok || !session?.access_token || !session?.refresh_token) {
            console.error("[Signup] user created but automatic session failed", login.status);
            return json(201, { created: true, error: "Conta criada. Entre com seu e-mail e senha." });
          }
          return json(201, { access_token: session.access_token, refresh_token: session.refresh_token });
        } catch (error) {
          console.error("[Signup] unexpected failure", error instanceof Error ? error.message : "unknown");
          return json(503, { error: "Cadastro temporariamente indisponível. Tente novamente em instantes." });
        }
      },
    },
  },
});
