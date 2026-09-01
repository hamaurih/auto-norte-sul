import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";
import { getBlingCredentials } from "@/lib/bling.functions";

const BLING_AUTHORIZE_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";
const CALLBACK_PATH = "/api/public/bling/callback";
const ALLOWED_CALLBACK_HOSTS = new Set([
  "nortesulauto.com.br",
  "www.nortesulauto.com.br",
  "norte-sul-auto-hub.lovable.app",
]);

function randomState(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

async function hashState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

function validateRedirectUri(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== CALLBACK_PATH ||
    !ALLOWED_CALLBACK_HOSTS.has(url.hostname)
  ) {
    throw new Error("Redirect URI do Bling não autorizada.");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

export const getSecureBlingAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { redirectUri: string }) => input)
  .handler(async ({ data, context }) => {
    await requireTenantRole(context.supabase, context.userId, context.tenantId, ["owner", "admin"]);

    const redirectUri = validateRedirectUri(data.redirectUri);
    const { data: cfg, error: cfgError } = await (context.supabase as any)
      .from("bling_config")
      .select("id,client_id,client_secret_encrypted")
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (cfgError || !cfg?.id) {
      throw new Error(cfgError?.message ?? "Configuração Bling não encontrada para este ambiente.");
    }
    const { clientId, clientSecret } = await getBlingCredentials(context.supabase, context.tenantId, cfg);
    if (!clientId || !clientSecret) {
      throw new Error("Informe Client ID e Client Secret antes de conectar ao Bling.");
    }

    const { error: updateError } = await (context.supabase as any)
      .from("bling_config")
      .update({ redirect_uri: redirectUri, updated_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("id", cfg.id);
    if (updateError) throw new Error(updateError.message);

    const state = randomState();
    const stateHash = await hashState(state);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await (supabaseAdmin as any)
      .from("oauth_authorization_states")
      .delete()
      .eq("tenant_id", context.tenantId)
      .lt("expires_at", new Date(Date.now() - 60 * 60_000).toISOString());

    const { error: stateError } = await (supabaseAdmin as any)
      .from("oauth_authorization_states")
      .insert({
        tenant_id: context.tenantId,
        state_hash: stateHash,
        provider: "bling",
        actor_user_id: context.userId,
        config_id: cfg.id,
        redirect_uri: redirectUri,
        expires_at: expiresAt,
      });
    if (stateError) throw new Error(stateError.message);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });
    return { url: `${BLING_AUTHORIZE_URL}?${params.toString()}` };
  });
