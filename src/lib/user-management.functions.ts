import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb, type TenantDb } from "@/integrations/supabase/tenant-db";
import {
  defaultPermissionsForRole,
  permissionMapFromRows,
  permissionRowsFromMap,
  type ModulePermission,
  type SystemRole,
} from "@/lib/permissions";
import type { User } from "@supabase/supabase-js";

const roleSchema = z.enum(["admin", "gerente", "vendedor", "consulta"]);
const moduleSchema = z.enum([
  "dashboard",
  "sales",
  "crm",
  "catalog",
  "inventory",
  "purchasing",
  "marketing",
  "integrations",
  "ai",
  "reports",
  "fiscal",
  "users",
  "settings",
  "audit",
]);
const permissionSchema = z.object({
  module_key: moduleSchema,
  can_view: z.boolean(),
  can_create: z.boolean(),
  can_update: z.boolean(),
  can_delete: z.boolean(),
});

const inviteSchema = z.object({
  full_name: z.string().trim().min(2, "Informe o nome completo.").max(160),
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(320),
  phone: z.string().trim().max(40).optional(),
  temporary_password: z.string().min(8, "A senha provisória deve ter no mínimo 8 caracteres.").max(72),
  role: roleSchema,
  permissions: z.array(permissionSchema).min(1),
});

const updateSchema = z.object({
  membership_id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  permissions: z.array(permissionSchema).min(1).optional(),
});

const internalLegacyRoles = ["admin", "gerente", "vendedor"] as const;
type TenantRole = "owner" | "admin" | "manager" | "sales" | "viewer";
type TenantMembership = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
  active: boolean;
};
type ProfileRecord = { id: string; full_name: string | null; phone: string | null };

function isPermissionsTableMissing(error: unknown): boolean {
  const typed = error as { code?: string; message?: string } | null | undefined;
  const message = String(typed?.message ?? error ?? "").toLowerCase();
  return (
    typed?.code === "42P01" ||
    (message.includes("tenant_user_permissions") &&
      (message.includes("does not exist") ||
        message.includes("schema cache") ||
        message.includes("could not find the table")))
  );
}

function permissionsFromAppMetadata(
  user: User | null | undefined,
  tenantId: string,
): ModulePermission[] | null {
  const byTenant = user?.app_metadata?.tenant_permissions;
  if (!byTenant || typeof byTenant !== "object" || Array.isArray(byTenant)) return null;
  const rows = (byTenant as Record<string, unknown>)[tenantId];
  return Array.isArray(rows) ? (rows as ModulePermission[]) : null;
}

async function savePermissionsToAppMetadata(
  supabaseAdmin: TenantDb,
  tenantId: string,
  userId: string,
  permissions: ModulePermission[],
) {
  const { data: current, error: currentError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (currentError || !current.user) {
    throw new Error(currentError?.message ?? "Usuário de autenticação não encontrado.");
  }

  const metadata = (current.user.app_metadata ?? {}) as Record<string, unknown>;
  const existingByTenant =
    metadata.tenant_permissions &&
    typeof metadata.tenant_permissions === "object" &&
    !Array.isArray(metadata.tenant_permissions)
      ? (metadata.tenant_permissions as Record<string, unknown>)
      : {};
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...metadata,
      tenant_permissions: {
        ...existingByTenant,
        [tenantId]: permissions,
      },
    },
  });
  if (error) throw new Error(error.message);
}

function tenantRoleForSystemRole(role: SystemRole): TenantRole {
  const roles: Record<SystemRole, TenantRole> = {
    admin: "admin",
    gerente: "manager",
    vendedor: "sales",
    consulta: "viewer",
  };
  return roles[role];
}

function legacyRoleForSystemRole(role: SystemRole): "admin" | "gerente" | "vendedor" | "cliente" {
  const roles: Record<SystemRole, "admin" | "gerente" | "vendedor" | "cliente"> = {
    admin: "admin",
    gerente: "gerente",
    vendedor: "vendedor",
    consulta: "cliente",
  };
  return roles[role];
}

function systemRoleForTenantRole(role: string): SystemRole {
  if (role === "owner" || role === "admin") return "admin";
  if (role === "manager") return "gerente";
  if (role === "sales") return "vendedor";
  return "consulta";
}

function normalizePermissions(
  role: SystemRole,
  input: Array<z.infer<typeof permissionSchema>> | undefined,
): ModulePermission[] {
  const defaults = defaultPermissionsForRole(role);
  const rows = input?.length ? input : permissionRowsFromMap(defaults);
  const map = permissionMapFromRows(role, rows as Array<ModulePermission>);
  return permissionRowsFromMap(map).map((permission) => {
    const canView =
      permission.can_view ||
      permission.can_create ||
      permission.can_update ||
      permission.can_delete;
    return {
      ...permission,
      can_view: canView,
      can_create: canView && permission.can_create,
      can_update: canView && permission.can_update,
      can_delete: canView && permission.can_delete,
    };
  });
}

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return tdb(supabaseAdmin);
}

async function findUserByEmail(supabaseAdmin: TenantDb, email: string): Promise<User | null> {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(error.message);
    const user = (data?.users ?? []).find(
      (item: { email?: string }) => item.email?.toLowerCase() === email,
    );
    if (user) return user;
    if ((data?.users ?? []).length < 100) return null;
  }
  throw new Error("Não foi possível localizar o usuário pelo e-mail informado.");
}

async function requireTenantAdmin(
  supabaseAdmin: TenantDb,
  userId: string,
  tenantId: string,
  action: "view" | "create" | "update" = "view",
) {
  const { data: membership, error } = await supabaseAdmin
    .from("tenant_memberships")
    .select("id, tenant_id, user_id, role, active")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (membership) {
    if (!membership.active || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Somente administradores ativos podem gerenciar usuários.");
    }
    const { data: usersPermission, error: usersPermissionError } = await supabaseAdmin
      .from("tenant_user_permissions")
      .select("can_view, can_create, can_update")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("module_key", "users")
      .maybeSingle();
    const permissionsTableMissing = isPermissionsTableMissing(usersPermissionError);
    if (usersPermissionError && !permissionsTableMissing) {
      throw new Error(usersPermissionError.message);
    }
    const permissionField =
      action === "create" ? "can_create" : action === "update" ? "can_update" : "can_view";
    if (!permissionsTableMissing && usersPermission && !usersPermission[permissionField]) {
      throw new Error("Seu usuário não possui essa permissão no módulo de usuários.");
    }
    return membership as TenantMembership;
  }

  // Compatibility for the legacy admin created before tenant memberships were
  // backfilled. It is upgraded to an admin membership once, on the server.
  const { data: legacyRoles, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (roleError) throw new Error(roleError.message);
  if (!(legacyRoles ?? []).some((item: { role: string }) => item.role === "admin")) {
    throw new Error("Somente administradores ativos podem gerenciar usuários.");
  }

  const { data: upgraded, error: upgradeError } = await supabaseAdmin
    .from("tenant_memberships")
    .upsert(
      { tenant_id: tenantId, user_id: userId, role: "admin", active: true },
      { onConflict: "tenant_id,user_id" },
    )
    .select("id, tenant_id, user_id, role, active")
    .single();
  if (upgradeError) throw new Error(upgradeError.message);
  return upgraded as TenantMembership;
}

async function syncLegacyRole(
  supabaseAdmin: TenantDb,
  userId: string,
  role: SystemRole,
  active: boolean,
) {
  const { error: deleteError } = await supabaseAdmin
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .in("role", [...internalLegacyRoles]);
  if (deleteError) throw new Error(deleteError.message);

  if (active) {
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: legacyRoleForSystemRole(role) },
        { onConflict: "user_id,role" },
      );
    if (error) throw new Error(error.message);
  }
}

async function savePermissions(
  supabaseAdmin: TenantDb,
  tenantId: string,
  userId: string,
  permissions: ModulePermission[],
) {
  const { error } = await supabaseAdmin.from("tenant_user_permissions").upsert(
    permissions.map((permission) => ({ tenant_id: tenantId, user_id: userId, ...permission })),
    { onConflict: "tenant_id,user_id,module_key" },
  );
  if (!error) return;
  if (isPermissionsTableMissing(error)) {
    // Temporary compatibility while the production schema cache catches up.
    // The same scoped permissions remain server-side in Auth metadata.
    await savePermissionsToAppMetadata(supabaseAdmin, tenantId, userId, permissions);
    return;
  }
  throw new Error(error.message);
}

async function syncSalesRep(
  supabaseAdmin: TenantDb,
  tenantId: string,
  userId: string,
  role: SystemRole,
  active: boolean,
  fullName: string,
  email: string,
  invitedBy: string,
) {
  if (role === "vendedor") {
    const { error } = await supabaseAdmin.from("sales_reps").upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        full_name: fullName,
        email,
        active,
        invited_by: invitedBy,
      },
      { onConflict: "tenant_id,email" },
    );
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabaseAdmin
    .from("sales_reps")
    .update({ active: false })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

async function writeAuditEvent(
  supabaseAdmin: TenantDb,
  tenantId: string,
  actorUserId: string,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
) {
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("organization_id")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant?.organization_id) return;
  await supabaseAdmin.from("audit_events").insert({
    organization_id: tenant.organization_id,
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    action,
    resource_type: "tenant_user",
    resource_id: resourceId,
    metadata,
  });
}

export type ManagedUser = {
  membership_id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: SystemRole;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  permissions: ModulePermission[];
};

export const listTenantUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    await requireTenantAdmin(supabaseAdmin, context.userId, context.tenantId);

    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from("tenant_memberships")
      .select("id, tenant_id, user_id, role, active, created_at")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: true });
    if (membershipError) throw new Error(membershipError.message);

    const ids = (memberships ?? []).map((membership: { user_id: string }) => membership.user_id);
    if (ids.length === 0) return [] as ManagedUser[];

    const [profilesResult, permissionsResult] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", ids),
      supabaseAdmin
        .from("tenant_user_permissions")
        .select("user_id, module_key, can_view, can_create, can_update, can_delete")
        .eq("tenant_id", context.tenantId)
        .in("user_id", ids),
    ]);
    const { data: profiles, error: profileError } = profilesResult;
    const { data: permissionRows, error: permissionError } = permissionsResult;
    const permissionTableMissing = isPermissionsTableMissing(permissionError);
    if (profileError) throw new Error(profileError.message);
    if (permissionError && !permissionTableMissing) throw new Error(permissionError.message);

    const authUsers: User[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw new Error(error.message);
      authUsers.push(...(data?.users ?? []));
      if ((data?.users ?? []).length < 100) break;
    }

    const profileById = new Map<string, ProfileRecord>(
      (profiles ?? []).map((profile: ProfileRecord) => [profile.id, profile]),
    );
    const authById = new Map<string, User>(authUsers.map((user) => [user.id, user]));
    const permissionsByUser = new Map<string, ModulePermission[]>();
    if (permissionTableMissing) {
      for (const authUser of authUsers) {
        const metadataRows = permissionsFromAppMetadata(authUser, context.tenantId);
        if (metadataRows) permissionsByUser.set(authUser.id, metadataRows);
      }
    }
    for (const row of permissionRows ?? []) {
      const list = permissionsByUser.get(row.user_id) ?? [];
      list.push(row as ModulePermission);
      permissionsByUser.set(row.user_id, list);
    }

    return (memberships ?? []).map((membership: TenantMembership & { created_at: string }) => {
      const authUser = authById.get(membership.user_id);
      const profile = profileById.get(membership.user_id);
      const role = systemRoleForTenantRole(membership.role);
      const email = authUser?.email ?? "";
      return {
        membership_id: membership.id,
        user_id: membership.user_id,
        full_name: profile?.full_name || authUser?.user_metadata?.full_name || email || "Usuário",
        email,
        phone: profile?.phone ?? null,
        role,
        active: Boolean(membership.active),
        must_change_password: authUser?.app_metadata?.must_change_password === true,
        created_at: membership.created_at,
        last_sign_in_at: authUser?.last_sign_in_at ?? null,
        permissions: permissionRowsFromMap(
          permissionMapFromRows(role, permissionsByUser.get(membership.user_id) ?? []),
        ),
      } satisfies ManagedUser;
    });
  });

export const inviteTenantUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    await requireTenantAdmin(supabaseAdmin, context.userId, context.tenantId, "create");
    const email = data.email.trim().toLowerCase();
    let user = await findUserByEmail(supabaseAdmin, email);
    let createdAccount = false;

    if (!user) {
      const { data: createdUser, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: data.temporary_password,
        email_confirm: true,
        user_metadata: { full_name: data.full_name.trim() },
        app_metadata: { must_change_password: true },
      });
      if (error || !createdUser.user) {
        throw new Error(`Não foi possível criar o usuário: ${error?.message ?? "resposta inválida"}`);
      }
      user = createdUser.user;
      createdAccount = true;
    }

    const { data: existingMembership, error: existingMembershipError } = await supabaseAdmin
      .from("tenant_memberships")
      .select("id, active")
      .eq("tenant_id", context.tenantId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingMembershipError) throw new Error(existingMembershipError.message);
    if (existingMembership?.active) {
      if (createdAccount) await supabaseAdmin.auth.admin.deleteUser(user.id);
      throw new Error("Este e-mail já possui acesso ativo neste ambiente.");
    }

    try {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          { id: user.id, full_name: data.full_name.trim(), phone: data.phone?.trim() || null },
          { onConflict: "id" },
        );
      if (profileError) throw new Error(profileError.message);

      const { data: membership, error: membershipError } = await supabaseAdmin
        .from("tenant_memberships")
        .upsert(
          {
            tenant_id: context.tenantId,
            user_id: user.id,
            role: tenantRoleForSystemRole(data.role),
            active: true,
          },
          { onConflict: "tenant_id,user_id" },
        )
        .select("id")
        .single();
      if (membershipError) throw new Error(membershipError.message);

      await syncLegacyRole(supabaseAdmin, user.id, data.role, true);
      await savePermissions(
        supabaseAdmin,
        context.tenantId,
        user.id,
        normalizePermissions(data.role, data.permissions),
      );
      await syncSalesRep(
        supabaseAdmin,
        context.tenantId,
        user.id,
        data.role,
        true,
        data.full_name.trim(),
        email,
        context.userId,
      );
      await writeAuditEvent(
        supabaseAdmin,
        context.tenantId,
        context.userId,
        "user.created",
        user.id,
        {
          role: data.role,
          created_account: createdAccount,
          password_delivery: "manual",
        },
      );

      return {
        ok: true,
        created_account: createdAccount,
        temporary_password: createdAccount ? data.temporary_password : null,
        reactivated: Boolean(existingMembership),
        membership_id: membership.id,
      };
    } catch (error) {
      if (createdAccount) await supabaseAdmin.auth.admin.deleteUser(user.id);
      throw error;
    }
  });

export const updateTenantUserAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    await requireTenantAdmin(supabaseAdmin, context.userId, context.tenantId, "update");

    const { data: target, error: targetError } = await supabaseAdmin
      .from("tenant_memberships")
      .select("id, user_id, role, active")
      .eq("id", data.membership_id)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("Usuário não encontrado neste ambiente.");
    if (target.user_id === context.userId)
      throw new Error("Por segurança, você não pode alterar o próprio acesso.");

    const nextRole = data.role ?? systemRoleForTenantRole(target.role);
    const nextActive = data.active ?? target.active;
    if (target.active && !nextActive && ["owner", "admin"].includes(target.role)) {
      const { count, error: countError } = await supabaseAdmin
        .from("tenant_memberships")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .eq("active", true)
        .in("role", ["owner", "admin"]);
      if (countError) throw new Error(countError.message);
      if ((count ?? 0) <= 1)
        throw new Error("O ambiente precisa manter pelo menos um administrador ativo.");
    }
    if (
      ["owner", "admin"].includes(target.role) &&
      !["admin"].includes(tenantRoleForSystemRole(nextRole))
    ) {
      const { count, error: countError } = await supabaseAdmin
        .from("tenant_memberships")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .eq("active", true)
        .in("role", ["owner", "admin"]);
      if (countError) throw new Error(countError.message);
      if (target.active && (count ?? 0) <= 1)
        throw new Error("O ambiente precisa manter pelo menos um administrador ativo.");
    }

    const { error: membershipError } = await supabaseAdmin
      .from("tenant_memberships")
      .update({ role: tenantRoleForSystemRole(nextRole), active: nextActive })
      .eq("id", target.id)
      .eq("tenant_id", context.tenantId);
    if (membershipError) throw new Error(membershipError.message);

    const { data: authUser, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(
      target.user_id,
    );
    if (authUserError || !authUser.user)
      throw new Error(authUserError?.message ?? "Usuário de autenticação não encontrado.");
    const email = authUser.user?.email?.toLowerCase() ?? "";
    const fullName = data.full_name?.trim();
    const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", target.user_id)
      .maybeSingle();
    if (existingProfileError) throw new Error(existingProfileError.message);
    const salesRepName =
      fullName ||
      existingProfile?.full_name ||
      authUser.user.user_metadata?.full_name ||
      email ||
      "Usuário";
    if (fullName || data.phone !== undefined) {
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({
          ...(fullName ? { full_name: fullName } : {}),
          ...(data.phone !== undefined ? { phone: data.phone.trim() || null } : {}),
        })
        .eq("id", target.user_id);
      if (error) throw new Error(error.message);
    }

    await syncLegacyRole(supabaseAdmin, target.user_id, nextRole, nextActive);
    if (data.permissions || data.role) {
      await savePermissions(
        supabaseAdmin,
        context.tenantId,
        target.user_id,
        normalizePermissions(nextRole, data.permissions),
      );
    }
    await syncSalesRep(
      supabaseAdmin,
      context.tenantId,
      target.user_id,
      nextRole,
      nextActive,
      salesRepName,
      email,
      context.userId,
    );
    await writeAuditEvent(
      supabaseAdmin,
      context.tenantId,
      context.userId,
      "user.access_updated",
      target.user_id,
      {
        role: nextRole,
        active: nextActive,
        permissions_updated: Boolean(data.permissions || data.role),
      },
    );

    return { ok: true };
  });
