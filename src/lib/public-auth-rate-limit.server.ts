const ACCOUNT_WINDOW_MINUTES = 15;
const ACCOUNT_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 25;

type AdminClient = any;

export type PublicAuthRateLimit = {
  identifierHash: string;
  ipHash: string;
  blocked: boolean;
  retryAfterSeconds: number;
};

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function secureHash(value: string, pepper: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${pepper}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getPublicAuthRateLimit(
  supabaseAdmin: AdminClient,
  request: Request,
  identifier: string,
  pepper: string,
): Promise<PublicAuthRateLimit> {
  const [identifierHash, ipHash] = await Promise.all([
    secureHash(identifier, pepper),
    secureHash(clientIp(request), pepper),
  ]);
  const since = new Date(Date.now() - ACCOUNT_WINDOW_MINUTES * 60_000).toISOString();

  const [accountResult, ipResult] = await Promise.all([
    supabaseAdmin
      .from("auth_login_attempts")
      .select("id,created_at", { count: "exact" })
      .eq("identifier_hash", identifierHash)
      .eq("success", false)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1),
    supabaseAdmin
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
  const newest = accountResult.data?.[0]?.created_at || ipResult.data?.[0]?.created_at;
  const retryAfterSeconds = newest
    ? Math.max(60, Math.ceil((new Date(newest).getTime() + ACCOUNT_WINDOW_MINUTES * 60_000 - Date.now()) / 1000))
    : ACCOUNT_WINDOW_MINUTES * 60;

  return {
    identifierHash,
    ipHash,
    blocked: accountFailures >= ACCOUNT_MAX_FAILURES || ipFailures >= IP_MAX_FAILURES,
    retryAfterSeconds,
  };
}

export async function recordPublicAuthFailure(
  supabaseAdmin: AdminClient,
  rateLimit: Pick<PublicAuthRateLimit, "identifierHash" | "ipHash">,
) {
  await supabaseAdmin.from("auth_login_attempts").insert({
    identifier_hash: rateLimit.identifierHash,
    ip_hash: rateLimit.ipHash,
    success: false,
  });
}

export async function clearPublicAuthFailures(
  supabaseAdmin: AdminClient,
  identifierHash: string,
) {
  await supabaseAdmin
    .from("auth_login_attempts")
    .delete()
    .eq("identifier_hash", identifierHash)
    .eq("success", false);
}
