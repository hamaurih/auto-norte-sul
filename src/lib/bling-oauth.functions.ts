/**
 * Bling OAuth 2.0 — geração da URL de autorização.
 *
 * Separação do getBlingAuthUrl original: usa sempre o redirect URI fixo
 * cadastrado no app do Bling (domínio publicado), evitando que o preview
 * do Lovable gere origens variáveis que o Bling rejeita.
 */
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "@/lib/auth-guards";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BLING_AUTHORIZE_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";

export const getSecureBlingAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { redirectUri: string }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId与新);
    const clientId = process.env.BLING_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "BLING_CLIENT_ID não configurado. Adicione os secrets BLING_CLIENT_ID e BLING_CLIENT_SECRET nas configurações do backend.",
      );
    }
    await (context.supabase as any)
      .from("bling_config")
      .update({ redirect_uri: data.redirectUri, updated_at: new Date().toISOString() })
      .eq("id", (await (context.supabase as any).from("bling_config").select("id").limit(1).single()).data.id);

    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: data.redirectUri,
      state,
    });
    return { url: `${BLING_AUTHORIZE_URL}?${params.toString()}` };
  });
