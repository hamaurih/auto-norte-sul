/**
 * Public Supabase connection resolver (client-safe).
 *
 * Only public connection data is resolved here. The publishable key is designed
 * to be shipped to browsers and remains protected by Supabase RLS policies.
 * Never resolve service_role or any secret key in this module.
 */
const DEFAULT_SUPABASE_URL = "https://pleuoxzocgoajmymipqi.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_gLG1B4vn7B3xcqd8Dci4Sw_MyEY3PPn";

function nonEmpty(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function fromProcessEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  return nonEmpty(process.env[name]);
}

export function supabaseUrl(): string {
  return (
    nonEmpty(import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    fromProcessEnv("SUPABASE_URL") ||
    fromProcessEnv("VITE_SUPABASE_URL") ||
    DEFAULT_SUPABASE_URL
  );
}

export function supabasePublishableKey(): string {
  return (
    nonEmpty(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
    fromProcessEnv("SUPABASE_PUBLISHABLE_KEY") ||
    fromProcessEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY
  );
}

export function missingSupabaseEnvMessage(url?: string, key?: string): string {
  const missing = [
    ...(!url ? ["SUPABASE_URL"] : []),
    ...(!key ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
  return `Missing Supabase environment variable(s): ${missing.join(", ")}.`;
}
