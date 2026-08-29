import { createClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "@/integrations/supabase/env";

export type ApiAuthContext = {
  userId: string;
  token: string;
};

export async function requireApiAuth(request: Request): Promise<ApiAuthContext> {
  const authHeader = request.headers.get("authorization")?.trim() ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "Autenticação obrigatória." }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "WWW-Authenticate": "Bearer",
      },
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token || token.split(".").length !== 3) {
    throw new Response(JSON.stringify({ error: "Token inválido." }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "WWW-Authenticate": "Bearer",
      },
    });
  }

  const client = createClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) {
    throw new Response(JSON.stringify({ error: "Token expirado ou inválido." }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "WWW-Authenticate": "Bearer error=\"invalid_token\"",
      },
    });
  }

  return { userId: data.user.id, token };
}
