import { createFileRoute } from "@tanstack/react-router";

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/cutover-bridge-hash")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AUTH_RATE_LIMIT_PEPPER || "";
        if (key.length < 32) {
          return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        return Response.json(
          { ok: true, sha256: await sha256Hex(key) },
          { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
        );
      },
    },
  },
});
