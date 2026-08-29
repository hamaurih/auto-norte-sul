/**
 * tenant-access.ts — resolução de acesso do usuário no tenant ativo (client-safe).
 *
 * Fase 1: `public.user_roles` está descontinuada. A ÚNICA fonte de autorização
 * é `tenant_memberships` (+ `tenant_user_permissions`). Este módulo centraliza
 * a resolução do tenant ativo e do papel do usuário nele, para uso em guards
 * de rota e no hook de sessão.
 */
import { supabase } from "@/integrations/supabase/client";
import { activeTenantSlug } from "@/integrations/supabase/tenant";
import { tdb } from "@/integrations/supabase/tenant-db";
import type { SystemRole } from "@/lib/permissions";

export type TenantMembershipRole =
  | "owner"
  | "admin"
  | "manager"
  | "stock"
  | "sales"
  | "cashier"
  | "finance"
  | "accountant"
  | "support"
  | "viewer";

export type TenantAccess = {
  tenantId: string;
  role: TenantMembershipRole;
};

/** Resolve o tenant_id do storefront/tenant ativo (slug local). */
export async function resolveActiveTenantId(): Promise<string | null> {
  const db = tdb(supabase);
  const slug = activeTenantSlug();
  try {
    const storefront = await db
      .from("tenant_storefronts")
      .select("tenant_id")
      .eq("slug", slug)
      .maybeSingle();
    const fromStorefront = (storefront.data?.tenant_id as string | undefined) ?? null;
    if (fromStorefront) return fromStorefront;

    const tenant = await db.from("tenants").select("id").eq("slug", slug).maybeSingle();
    return (tenant.data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Membership ativa do usuário no tenant ativo — ou null. */
export async function fetchTenantAccess(userId: string): Promise<TenantAccess | null> {
  const tenantId = await resolveActiveTenantId();
  if (!tenantId) return null;
  try {
    const membership = await tdb(supabase)
      .from("tenant_memberships")
      .select("tenant_id, role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle();
    if (!membership.data?.tenant_id) return null;
    return {
      tenantId: membership.data.tenant_id as string,
      role: String(membership.data.role ?? "viewer") as TenantMembershipRole,
    };
  } catch {
    return null;
  }
}

export const ADMIN_TENANT_ROLES: TenantMembershipRole[] = ["owner", "admin"];
export const STAFF_TENANT_ROLES: TenantMembershipRole[] = ["owner", "admin", "manager"];
export const SALES_TENANT_ROLES: TenantMembershipRole[] = ["owner", "admin", "manager", "sales"];

export function isTenantAdmin(access: TenantAccess | null): boolean {
  return !!access && ADMIN_TENANT_ROLES.includes(access.role);
}

export function isTenantStaff(access: TenantAccess | null): boolean {
  return !!access && STAFF_TENANT_ROLES.includes(access.role);
}

export function isTenantSales(access: TenantAccess | null): boolean {
  return !!access && SALES_TENANT_ROLES.includes(access.role);
}

/** Papel tenant → papel de sistema usado pela UI. */
export function systemRoleFromTenantRole(role: TenantMembershipRole | null | undefined): SystemRole {
  if (role === "owner" || role === "admin") return "admin";
  if (role === "manager") return "gerente";
  if (role === "sales") return "vendedor";
  return "consulta";
}

/** Papéis de compatibilidade de UI, derivados exclusivamente do papel tenant. */
export function uiRolesFromTenantRole(
  role: TenantMembershipRole | null | undefined,
): Array<"admin" | "gerente" | "vendedor" | "cliente"> {
  const systemRole = systemRoleFromTenantRole(role);
  if (systemRole === "admin") return ["admin"];
  if (systemRole === "gerente") return ["gerente"];
  if (systemRole === "vendedor") return ["vendedor"];
  return ["cliente"];
}

/**
 * Helper para `beforeLoad`: retorna o acesso do usuário autenticado no tenant
 * ativo. Sem membership ativa → null (o chamador decide o redirect).
 */
export async function currentTenantAccess(): Promise<{
  userId: string | null;
  access: TenantAccess | null;
}> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { userId: null, access: null };
  return { userId: data.user.id, access: await fetchTenantAccess(data.user.id) };
}
