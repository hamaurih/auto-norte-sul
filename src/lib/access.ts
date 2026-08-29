import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { activeTenantSlug } from "@/integrations/supabase/tenant";
import { tdb } from "@/integrations/supabase/tenant-db";

export type AccessOrganization = {
  id: string;
  slug: string;
  legal_name: string | null;
  trade_name: string | null;
  status: string;
  role: "owner" | "admin" | "billing" | "auditor";
};

export type AccessTenant = {
  id: string;
  name: string;
  slug: string;
  environment: "production" | "demo" | "sandbox";
  status: string;
  role: string;
  organization_id: string;
  storefront_slug: string | null;
  storefront_active: boolean | null;
};

export type AccessContext = {
  user_id: string | null;
  email: string | null;
  organizations: AccessOrganization[];
  tenants: AccessTenant[];
};

export const emptyAccessContext: AccessContext = {
  user_id: null,
  email: null,
  organizations: [],
  tenants: [],
};

/** Reports existing organization/tenant memberships; it grants nothing itself. */
export async function fetchAccessContext(): Promise<AccessContext> {
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return emptyAccessContext;

  const { data, error } = await tdb(supabase).rpc("my_access_context");
  if (error || !data) {
    return { ...emptyAccessContext, user_id: userRes.user.id, email: userRes.user.email ?? null };
  }
  const context = data as AccessContext;
  return {
    user_id: context.user_id ?? userRes.user.id,
    email: context.email ?? userRes.user.email ?? null,
    organizations: context.organizations ?? [],
    tenants: context.tenants ?? [],
  };
}

export function useAccessContext() {
  return useQuery({
    queryKey: ["access-context"],
    queryFn: fetchAccessContext,
    staleTime: 60_000,
  });
}

export function hasAnyMembership(context: AccessContext | undefined | null): boolean {
  return Boolean(context && (context.organizations.length > 0 || context.tenants.length > 0));
}

export function isOrganizationAdmin(context: AccessContext | undefined | null): boolean {
  return Boolean(context?.organizations.some((org) => org.role === "owner" || org.role === "admin"));
}

function hasTenantAdminMembership(context: AccessContext | undefined | null): boolean {
  return Boolean(context?.tenants.some((tenant) => tenant.role === "owner" || tenant.role === "admin"));
}

/**
 * @deprecated Transitional name only. This function NEVER reads user_roles and
 * grants access exclusively from canonical organization/tenant memberships.
 * Kept temporarily while older routes are migrated to direct tenant checks.
 */
export async function isLegacyStaff(userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  const context = await fetchAccessContext();
  if (context.user_id !== userId) return false;
  return isOrganizationAdmin(context) || hasTenantAdminMembership(context);
}

/** @deprecated See isLegacyStaff. Canonical authorization remains tenant membership only. */
export function useIsLegacyStaff(userId?: string | null) {
  return useQuery({
    queryKey: ["tenant-admin-compat", userId],
    queryFn: () => isLegacyStaff(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
}

export function activeTenant(context: AccessContext | undefined | null): AccessTenant | null {
  if (!context) return null;
  const slug = activeTenantSlug();
  return context.tenants.find((tenant) => tenant.storefront_slug === slug || tenant.slug === slug) ?? null;
}

export const environmentLabel: Record<string, string> = {
  production: "Conta real",
  demo: "Conta de teste",
  sandbox: "Sandbox",
};
