/**
 * Tenant-aware wrapper around the generated `requireSupabaseAuth` middleware.
 *
 * The generated middleware only provides `supabase`, `userId` and `claims`.
 * Server functions in this project also need the active tenant, resolved from
 * the `x-tenant-slug` request header (attached by the client middleware in
 * `src/start.ts`).
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth as baseRequireSupabaseAuth } from "./auth-middleware";
import { tdb } from "./tenant-db";
import { DEFAULT_TENANT_SLUG, TENANT_HEADER } from "./tenant";

export const requireSupabaseAuth = createMiddleware({ type: "function" })
  .middleware([baseRequireSupabaseAuth])
  .server(async ({ next, context }) => {
    const request = getRequest();
    const tenantSlug = request?.headers?.get(TENANT_HEADER) || DEFAULT_TENANT_SLUG;

    const sb = tdb(context.supabase);
    let tenantId: string | null = null;

    const { data: storefront } = await sb
      .from("tenant_storefronts")
      .select("tenant_id")
      .eq("slug", tenantSlug)
      .maybeSingle();
    tenantId = (storefront?.tenant_id as string | undefined) ?? null;

    if (!tenantId) {
      const { data: tenant } = await sb
        .from("tenants")
        .select("id")
        .eq("slug", tenantSlug)
        .maybeSingle();
      tenantId = (tenant?.id as string | undefined) ?? null;
    }

    if (!tenantId) {
      throw new Error(`Tenant não encontrado para o slug "${tenantSlug}".`);
    }

    return next({ context: { ...context, tenantId, tenantSlug } });
  });
