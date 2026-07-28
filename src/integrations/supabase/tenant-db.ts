import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Typed façade for the multi-tenant schema (tenants, tenant_memberships,
 * tenant_storefronts, tenant_company_profiles and the `tenant_id` columns).
 *
 * The generated `Database` types are regenerated only after the tenant
 * migrations run in the connected project. Until then this wrapper keeps the
 * tenant-aware code compiling without editing the generated files. Remove it
 * once `src/integrations/supabase/types.ts` includes the tenant schema.
 */
export type TenantDb = SupabaseClient<any, "public", any>;

export function tdb(client: unknown): TenantDb {
  return client as TenantDb;
}
