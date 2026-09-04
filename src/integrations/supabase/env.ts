/**
 * Public Supabase connection resolver (client-safe).
 *
 * Norte Sul has completed the catalog/auth/storage cutover to the official
 * project. Production must no longer honor stale Vercel variables that point
 * to the legacy project.
 */
const OFFICIAL_SUPABASE_URL = "https://pzwjbitjersngordgcsh.supabase.co";
const OFFICIAL_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_8lqjNzJHLqVmGWSJoxHqQA_jSYMzoqX";

export function supabaseUrl(): string {
  return OFFICIAL_SUPABASE_URL;
}

export function supabasePublishableKey(): string {
  return OFFICIAL_SUPABASE_PUBLISHABLE_KEY;
}

export function missingSupabaseEnvMessage(url?: string, key?: string): string {
  const missing = [
    ...(!url ? ["SUPABASE_URL"] : []),
    ...(!key ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
  return `Missing Supabase environment variable(s): ${missing.join(", ")}.`;
}
