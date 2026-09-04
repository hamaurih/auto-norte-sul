import { createFileRoute } from "@tanstack/react-router";
import { supabasePublishableKey, supabaseUrl } from "@/integrations/supabase/env";

export const Route = createFileRoute("/api/public/auth-key-check")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const response = await fetch(`${supabaseUrl()}/auth/v1/settings`, {
            headers: {
              apikey: supabasePublishableKey(),
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(8000),
          });
          return Response.json(
            {
              ok: response.ok,
              status: response.status,
              project: "pzwjbitjersngordgcsh",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            { ok: false, status: -1, project: "pzwjbitjersngordgcsh" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
