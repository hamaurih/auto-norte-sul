import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { tdb } from "@/integrations/supabase/tenant-db";
import {
  fetchTenantAccess,
  systemRoleFromTenantRole,
  uiRolesFromTenantRole,
} from "@/lib/tenant-access";
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

function permissionsFromAppMetadata(
  user: User,
  tenantId: string,
): ModulePermission[] | null {
  const byTenant = user.app_metadata?.tenant_permissions;
  if (!byTenant || typeof byTenant !== "object" || Array.isArray(byTenant)) return null;
  const rows = (byTenant as Record<string, unknown>)[tenantId];
  return Array.isArray(rows) ? (rows as ModulePermission[]) : null;
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

    async function hydrate(session: Session | null) {
      if (!session?.user) {
        if (!cancelled) setState({ ...empty, loading: false });
        return;
      }
      const [{ data: profile }, tenantAccess] = await Promise.all([
        supabase.from("profiles").select("customer_group, b2b_status").eq("id", session.user.id).maybeSingle(),
        fetchTenantAccess(session.user.id),
      ]);
      const customerGroup = (profile?.customer_group ?? "b2c") as CustomerGroup;
      const b2bStatus = (profile?.b2b_status ?? "none") as B2BStatus;

      const systemRole: SystemRole = systemRoleFromTenantRole(tenantAccess?.role);
      const roles = uiRolesFromTenantRole(tenantAccess?.role) as AppRole[];

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

      const isStaff = Boolean(
        tenantAccess &&
          (["admin", "gerente", "vendedor"].includes(systemRole) ||
            Object.values(permissions).some((permission) => permission.can_view)),
      );
      const isAdmin = Boolean(tenantAccess && systemRole === "admin");
      const isSalesRep = systemRole === "vendedor";
      const b2bGroup = ["revendedor", "oficina", "distribuidor"].includes(customerGroup);
      if (!cancelled)
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


    supabase.auth
      .getSession()
      .then(({ data }) => {
        void hydrate(data.session);
      })
      .catch(() => {
        if (!cancelled) setState({ ...empty, loading: false });
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      // Do not return/await a Promise inside this callback. The auth client can
      // hold its internal lock while dispatching auth events, and running table
      // queries here directly can block every catalog query on authenticated
      // page loads, leaving the home stuck in skeleton state.
      window.setTimeout(() => {
        void hydrate(session);
      }, 0);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
