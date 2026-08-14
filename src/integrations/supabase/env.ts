/**
 * Public Supabase connection resolver (client-safe).
 *
 * The DEV project connects to the external Supabase instance through the public
 * variables only. Server runtimes receive `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`
 * when the platform injects them; when they are absent (preview/dev), we fall back
 * to the build-time public `VITE_*` values, which are the same non-secret values.
 *
 * Never resolve service_role or any secret key here.
 */
function fromProcessEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function supabaseUrl(): string | undefined {
  return (
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    fromProcessEnv("SUPABASE_URL") ||
    fromProcessEnv("VITE_SUPABASE_URL")
  );
}

export function supabasePublishableKey(): string | undefined {
  return (
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
    fromProcessEnv("SUPABASE_PUBLISHABLE_KEY") ||
    fromProcessEnv("VITE_SUPABASE_PUBLISHABLE_KEY")
  );
}

export function missingSupabaseEnvMessage(url?: string, key?: string): string {
  const missing = [
    ...(!url ? ["SUPABASE_URL"] : []),
    ...(!key ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
  return `Missing Supabase environment variable(s): ${missing.join(", ")}.`;
}
