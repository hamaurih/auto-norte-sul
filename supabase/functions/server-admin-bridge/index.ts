import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function allowedPath(path: string): boolean {
  return path.startsWith("/rest/v1/") ||
    path.startsWith("/auth/v1/admin/") ||
    path.startsWith("/storage/v1/") ||
    path.startsWith("/functions/v1/");
}

function copyForwardHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const name of ["content-type", "accept", "prefer", "range", "if-match", "if-none-match", "x-client-info", "x-upsert", "cache-control"]) {
    const value = req.headers.get(`x-forward-${name}`) ?? req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("apikey", SERVICE_ROLE_KEY);
  headers.set("Authorization", `Bearer ${SERVICE_ROLE_KEY}`);
  return headers;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const credential = req.headers.get("x-cutover-key")?.trim() || "";
  if (credential.length < 32) {
    return new Response("forbidden", { status: 403 });
  }

  const { data: verifier, error: verifierError } = await admin
    .from("server_admin_bridge_credentials")
    .select("credential_sha256,active")
    .eq("singleton", true)
    .maybeSingle();

  if (verifierError || !verifier?.active || !verifier.credential_sha256) {
    return new Response("forbidden", { status: 403 });
  }

  const actualHash = await sha256Hex(credential);
  if (actualHash !== verifier.credential_sha256) {
    return new Response("forbidden", { status: 403 });
  }

  const method = (req.headers.get("x-proxy-method") || "GET").toUpperCase();
  if (!["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"].includes(method)) {
    return new Response("method not allowed", { status: 405 });
  }

  const rawPath = req.headers.get("x-proxy-path") || "";
  if (!rawPath.startsWith("/") || rawPath.includes("\\") || rawPath.includes("..") || !allowedPath(rawPath)) {
    return new Response("forbidden target", { status: 403 });
  }

  const target = new URL(rawPath, SUPABASE_URL);
  if (target.origin !== new URL(SUPABASE_URL).origin) {
    return new Response("forbidden target", { status: 403 });
  }

  const headers = copyForwardHeaders(req);
  const init: RequestInit = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") {
    init.body = req.body;
    // @ts-ignore Deno fetch requires duplex only in some runtimes; harmless where ignored.
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    console.error("[server-admin-bridge] upstream error", error);
    return new Response("upstream unavailable", { status: 502 });
  }

  void admin
    .from("server_admin_bridge_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("singleton", true);

  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-range", "range-unit", "location", "etag", "last-modified", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Cache-Control", upstream.headers.get("cache-control") || "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
});
