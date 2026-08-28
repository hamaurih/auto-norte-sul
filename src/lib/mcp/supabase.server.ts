import { createClient } from "@supabase/supabase-js";

// Projeto Supabase atualmente usado por nortesulauto.com.br.
// A chave publishable é adequada para ferramentas MCP somente de leitura;
// service_role nunca deve ser exposta a chamadas externas.
const DEFAULT_SUPABASE_URL = "https://pleuoxzocgoajmymipqi.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_gLG1B4vn7B3xcqd8Dci4Sw_MyEY3PPn";
const DEFAULT_TENANT_SLUG = "norte-sul-real";

function resolveHttpsUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_SUPABASE_URL;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.origin : DEFAULT_SUPABASE_URL;
  } catch {
    return DEFAULT_SUPABASE_URL;
  }
}

function resolveTenantSlug(): string {
  return (
    process.env.PUBLIC_TENANT_SLUG?.trim() ||
    process.env.TENANT_STOREFRONT_SLUG?.trim() ||
    process.env.VITE_TENANT_STOREFRONT_SLUG?.trim() ||
    DEFAULT_TENANT_SLUG
  );
}

export function createMcpSupabase() {
  const url = resolveHttpsUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  return createClient(url, key, {
    global: { headers: { "x-tenant-slug": resolveTenantSlug() } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
