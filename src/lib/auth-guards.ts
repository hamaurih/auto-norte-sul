/**
 * auth-guards.ts — Funções de autorização reutilizáveis para server functions.
 *
 * ARC-12: Antes havia 5+ cópias de assertAdmin/assertStaff espalhadas.
 * Este módulo é a fonte única de verdade para todos os guards de acesso.
 */

export type LegacyRole = "admin" | "gerente" | "vendedor" | "staff";
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

// ─────────────────────────────────────────────────────────────
// Guards legados (tabela user_roles — pré-SaaS)
// ─────────────────────────────────────────────────────────────

export async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const ok = (roles ?? []).some((r: { role: string }) => r.role === "admin");
  if (!ok) throw new Error("Forbidden: requer papel admin");
}

export async function assertStaff(supabase: any, userId: string): Promise<void> {
  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const ok = (roles ?? []).some((r: { role: string }) =>
    ["admin", "gerente"].includes(r.role),
  );
  if (!ok) throw new Error("Forbidden: requer papel admin ou gerente");
}

// ─────────────────────────────────────────────────────────────
// Guards multi-tenant (tabela tenant_memberships — pós-SaaS)
// ─────────────────────────────────────────────────────────────

export async function requireTenantRole(
  sb: any,
  userId: string,
  tenantId: string,
  roles: TenantRole[] = ["owner", "admin", "manager"],
): Promise<{ tenant_id: string; role: TenantRole }> {
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: TenantRole }) =>
    roles.includes(item.role),
  );
  if (!membership)
    throw new Error(
      `Usuário sem acesso ativo (requer: ${roles.join(", ")})`,
    );
  return membership as { tenant_id: string; role: TenantRole };
}

export async function requireTenantSalesRole(
  sb: any,
  userId: string,
  tenantId: string,
): Promise<{ tenant_id: string; role: TenantRole }> {
  return requireTenantRole(sb, userId, tenantId, [
    "owner",
    "admin",
    "manager",
    "sales",
  ]);
}

export async function requireTenantCatalogRole(
  sb: any,
  userId: string,
  tenantId: string,
): Promise<{ tenant_id: string; role: TenantRole }> {
  return requireTenantRole(sb, userId, tenantId, [
    "owner",
    "admin",
    "manager",
    "stock",
  ]);
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

// ─────────────────────────────────────────────────────────────
// Guard para organização (convites, billing)
// ─────────────────────────────────────────────────────────────

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
  if (!membership)
    throw new Error("Somente proprietário ou administrador da organização");
  return membership as { organization_id: string; role: string };
}
