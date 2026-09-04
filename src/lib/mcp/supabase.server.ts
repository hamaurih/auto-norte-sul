import { createClient } from "@supabase/supabase-js";

// Banco oficial da Norte Sul. Variáveis antigas da Vercel não podem mais
// redirecionar as ferramentas MCP para o projeto legado.
const OFFICIAL_SUPABASE_URL = "https://pzwjbitjersngordgcsh.supabase.co";
const OFFICIAL_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_8lqjNzJHLqVmGWSJoxHqQA_jSYMzoqX";
const DEFAULT_TENANT_SLUG = "norte-sul-real";

function resolveTenantSlug(): string {
  return (
    process.env.PUBLIC_TENANT_SLUG?.trim() ||
    process.env.TENANT_STOREFRONT_SLUG?.trim() ||
    process.env.VITE_TENANT_STOREFRONT_SLUG?.trim() ||
    DEFAULT_TENANT_SLUG
  );
}

export function createMcpSupabase() {
  return createClient(OFFICIAL_SUPABASE_URL, OFFICIAL_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { "x-tenant-slug": resolveTenantSlug() } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
