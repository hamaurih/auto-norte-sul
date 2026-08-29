/**
 * Tenant-scoped authorization guards for server functions.
 * Authorization is exclusively tenant_memberships + tenant_user_permissions.
 */
export type TenantRole =
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

export async function requireTenantRole(
  sb: any,
  userId: string,
  tenantId: string,
  roles: TenantRole[] = ["owner", "admin", "manager"],
): Promise<{ tenant_id: string; role: TenantRole }> {
  if (!tenantId) throw new Error("Tenant obrigatório para autorização.");
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: TenantRole }) => roles.includes(item.role));
  if (!membership) {
    throw new Error(`Usuário sem acesso ativo neste ambiente (requer: ${roles.join(", ")})`);
  }
  return membership as { tenant_id: string; role: TenantRole };
}

/** Compatibility name for old call sites; never authorizes without tenant context. */
export async function assertAdmin(sb: any, userId: string, tenantId?: string): Promise<void> {
  if (!tenantId) throw new Error("Tenant obrigatório: use requireTenantRole para autorização administrativa.");
  await requireTenantRole(sb, userId, tenantId, ["owner", "admin"]);
}

/** Compatibility name for old call sites; never authorizes without tenant context. */
export async function assertStaff(sb: any, userId: string, tenantId?: string): Promise<void> {
  if (!tenantId) throw new Error("Tenant obrigatório: use requireTenantRole para autorização de equipe.");
  await requireTenantRole(sb, userId, tenantId, ["owner", "admin", "manager"]);
}

export async function requireTenantSalesRole(
  sb: any,
  userId: string,
  tenantId: string,
): Promise<{ tenant_id: string; role: TenantRole }> {
  return requireTenantRole(sb, userId, tenantId, ["owner", "admin", "manager", "sales"]);
}

export async function requireTenantCatalogRole(
  sb: any,
  userId: string,
  tenantId: string,
): Promise<{ tenant_id: string; role: TenantRole }> {
  return requireTenantRole(sb, userId, tenantId, ["owner", "admin", "manager", "stock"]);
}

export const ALL_TENANT_ROLES: TenantRole[] = [
  "owner",
  "admin",
  "manager",
  "stock",
  "sales",
  "cashier",
  "finance",
  "accountant",
  "support",
  "viewer",
];

export async function requireAnyTenantRole(
  sb: any,
  userId: string,
  tenantId: string,
): Promise<{ tenant_id: string; role: TenantRole }> {
  return requireTenantRole(sb, userId, tenantId, ALL_TENANT_ROLES);
}

export async function requireOrganizationAdmin(
  sb: any,
  userId: string,
): Promise<{ organization_id: string; role: string }> {
  const { data, error } = await sb
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("user_id", userId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: string }) =>
    ["owner", "admin"].includes(item.role),
  );
  if (!membership) throw new Error("Somente proprietário ou administrador da organização");
  return membership as { organization_id: string; role: string };
}
