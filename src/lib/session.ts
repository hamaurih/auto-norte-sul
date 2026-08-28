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
        const storefront = await db
          .from("tenant_storefronts")
          .select("tenant_id")
          .eq("slug", slug)
          .maybeSingle();
        let tenantId = (storefront.data?.tenant_id as string | undefined) ?? null;
        if (!tenantId) {
          const tenant = await db
            .from("tenants")
            .select("id")
            .eq("slug", slug)
            .maybeSingle();
          tenantId = (tenant.data?.id as string | undefined) ?? null;
        }
        if (!tenantId) return null;
        const membership = await db
          .from("tenant_memberships")
          .select("tenant_id, role")
          .eq("tenant_id", tenantId)
          .eq("user_id", userId)
          .eq("active", true)
          .maybeSingle();
        if (!membership.data?.tenant_id) return null;
        return {
          tenantId: membership.data.tenant_id as string,
          role: String(membership.data.role ?? "viewer"),
        };
      } catch {
        return null;
      }
    }

    async function hydrate(session: Session | null) {
      if (!session?.user) {
        if (!cancelled) setState({ ...empty, loading: false });
        return;
      }
      const [{ data: rolesData }, { data: profile }, tenantAccess] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", session.user.id),
        supabase.from("profiles").select("customer_group, b2b_status").eq("id", session.user.id).maybeSingle(),
        findActiveTenantAccess(session.user.id),
      ]);
      const roles = ((rolesData ?? []).map((r) => r.role) as AppRole[]);
      const customerGroup = (profile?.customer_group ?? "b2c") as CustomerGroup;
      const b2bStatus = (profile?.b2b_status ?? "none") as B2BStatus;
      const legacyIsStaff = roles.some((r) => r === "admin" || r === "gerente");
      const legacyIsAdmin = roles.some((r) => r === "admin");
      const legacyIsSalesRep = roles.some((r) => r === "vendedor");

      const tenantRole: SystemRole =
        tenantAccess?.role === "owner" || tenantAccess?.role === "admin"
          ? "admin"
          : tenantAccess?.role === "manager"
            ? "gerente"
            : tenantAccess?.role === "sales"
              ? "vendedor"
              : "consulta";
      const systemRole: SystemRole =
        tenantAccess ? tenantRole : legacyIsAdmin ? "admin" : roles.includes("gerente") ? "gerente" : legacyIsSalesRep ? "vendedor" : "consulta";
      let permissions = defaultPermissionsForRole(systemRole);
      if (tenantAccess) {
        const { data: permissionRows } = await tdb(supabase)
          .from("tenant_user_permissions")
          .select("module_key, can_view, can_create, can_update, can_delete")
          .eq("tenant_id", tenantAccess.tenantId)
          .eq("user_id", session.user.id);
        permissions = permissionMapFromRows(systemRole, (permissionRows ?? []) as ModulePermission[]);
      }

      const isTenantStaff = Boolean(
        tenantAccess && ["admin", "gerente", "vendedor"].includes(systemRole),
      );
      const isStaff = isTenantStaff || legacyIsStaff;
      const isAdmin = (tenantAccess && tenantRole === "admin") || legacyIsAdmin;
      const isSalesRep = legacyIsSalesRep || systemRole === "vendedor";
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
