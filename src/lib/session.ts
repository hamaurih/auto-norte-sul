import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { activeTenantSlug } from "@/integrations/supabase/tenant";
import { tdb } from "@/integrations/supabase/tenant-db";
import {
  defaultPermissionsForRole,
  permissionMapFromRows,
  type ModulePermission,
  type PermissionMap,
  type SystemRole,
} from "@/lib/permissions";
import type { Session, User } from "@supabase/supabase-js";

export type CustomerGroup = "b2c" | "b2b_pendente" | "revendedor" | "oficina" | "distribuidor";
export type B2BStatus = "none" | "pending" | "approved" | "rejected";
export type AppRole = "admin" | "gerente" | "vendedor" | "cliente";

export interface SessionState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  systemRole: SystemRole;
  permissions: PermissionMap;
  isSalesRep: boolean;
  isB2BApproved: boolean;
  isB2BPending: boolean;
  roles: AppRole[];
  customerGroup: CustomerGroup;
  b2bStatus: B2BStatus;
}

function permissionsFromAppMetadata(user: User, tenantId: string): ModulePermission[] | null {
  const byTenant = user.app_metadata?.tenant_permissions;
  if (!byTenant || typeof byTenant !== "object" || Array.isArray(byTenant)) return null;
  const rows = (byTenant as Record<string, unknown>)[tenantId];
  return Array.isArray(rows) ? (rows as ModulePermission[]) : null;
}

function systemRoleForTenantRole(role?: string | null): SystemRole {
  if (role === "owner" || role === "admin") return "admin";
  if (role === "manager") return "gerente";
  if (role === "sales") return "vendedor";
  return "consulta";
}

function appRolesForSystemRole(role: SystemRole): AppRole[] {
  if (role === "admin") return ["admin"];
  if (role === "gerente") return ["gerente"];
  if (role === "vendedor") return ["vendedor"];
  return ["cliente"];
}

const empty: SessionState = {
  user: null,
  session: null,
  loading: true,
  isAdmin: false,
  isStaff: false,
  systemRole: "consulta",
  permissions: defaultPermissionsForRole("consulta"),
  isSalesRep: false,
  isB2BApproved: false,
  isB2BPending: false,
  roles: [],
  customerGroup: "b2c",
  b2bStatus: "none",
};

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(empty);

  useEffect(() => {
    let cancelled = false;

    async function findActiveTenantAccess(userId: string): Promise<{ tenantId: string; role: string } | null> {
      try {
        const db = tdb(supabase);
        const slug = activeTenantSlug();
        const { data: storefront } = await db
          .from("tenant_storefronts")
          .select("tenant_id")
          .eq("slug", slug)
          .maybeSingle();
        let tenantId = (storefront?.tenant_id as string | undefined) ?? null;
        if (!tenantId) {
          const { data: tenant } = await db.from("tenants").select("id").eq("slug", slug).maybeSingle();
          tenantId = (tenant?.id as string | undefined) ?? null;
        }
        if (!tenantId) return null;
        const { data: membership } = await db
          .from("tenant_memberships")
          .select("tenant_id, role")
          .eq("tenant_id", tenantId)
          .eq("user_id", userId)
          .eq("active", true)
          .maybeSingle();
        if (!membership?.tenant_id) return null;
        return { tenantId: membership.tenant_id as string, role: String(membership.role ?? "viewer") };
      } catch {
        return null;
      }
    }

    async function hydrate(session: Session | null) {
      if (!session?.user) {
        if (!cancelled) setState({ ...empty, loading: false });
        return;
      }

      const [{ data: profile }, tenantAccess] = await Promise.all([
        supabase
          .from("profiles")
          .select("customer_group, b2b_status")
          .eq("id", session.user.id)
          .maybeSingle(),
        findActiveTenantAccess(session.user.id),
      ]);

      const customerGroup = (profile?.customer_group ?? "b2c") as CustomerGroup;
      const b2bStatus = (profile?.b2b_status ?? "none") as B2BStatus;
      const systemRole = systemRoleForTenantRole(tenantAccess?.role);
      let permissions = defaultPermissionsForRole(systemRole);

      if (tenantAccess) {
        const { data: permissionRows } = await tdb(supabase)
          .from("tenant_user_permissions")
          .select("module_key, can_view, can_create, can_update, can_delete")
          .eq("tenant_id", tenantAccess.tenantId)
          .eq("user_id", session.user.id);
        const metadataRows = permissionsFromAppMetadata(session.user, tenantAccess.tenantId);
        permissions = permissionMapFromRows(
          systemRole,
          ((permissionRows?.length ? permissionRows : metadataRows) ?? []) as ModulePermission[],
        );
      }

      const isAdmin = Boolean(tenantAccess && systemRole === "admin");
      const isSalesRep = Boolean(tenantAccess && systemRole === "vendedor");
      const isStaff = Boolean(
        tenantAccess &&
          (["admin", "gerente", "vendedor"].includes(systemRole) ||
            Object.values(permissions).some((permission) => permission.can_view)),
      );
      const b2bGroup = ["revendedor", "oficina", "distribuidor"].includes(customerGroup);
      const roles = appRolesForSystemRole(systemRole);

      if (!cancelled) {
        setState({
          user: session.user,
          session,
          loading: false,
          isAdmin,
          isStaff,
          systemRole,
          permissions,
          isSalesRep,
          isB2BApproved: isStaff || (b2bGroup && b2bStatus === "approved"),
          isB2BPending: customerGroup === "b2b_pendente" || b2bStatus === "pending",
          roles,
          customerGroup,
          b2bStatus,
        });
      }
    }

    supabase.auth
      .getSession()
      .then(({ data }) => void hydrate(data.session))
      .catch(() => {
        if (!cancelled) setState({ ...empty, loading: false });
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => void hydrate(session), 0);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
