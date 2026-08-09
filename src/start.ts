import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { TENANT_HEADER, activeTenantSlug } from "@/integrations/supabase/tenant";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const attachTenantHeader = createMiddleware({ type: "function" }).client(
  async ({ next }) => next({ headers: { [TENANT_HEADER]: activeTenantSlug() } }),
);

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, attachTenantHeader],
  requestMiddleware: [errorMiddleware],
}));
