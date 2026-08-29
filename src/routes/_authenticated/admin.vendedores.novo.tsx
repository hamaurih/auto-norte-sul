import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantAccess, isTenantStaff } from "@/lib/tenant-access";

export const Route = createFileRoute("/_authenticated/admin/vendedores/novo")({
  head: () => ({ meta: [{ title: "Novo vendedor · Norte Sul" }] }),
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });

    const access = await fetchTenantAccess(userRes.user.id);
    if (!isTenantStaff(access)) throw redirect({ to: "/" });

    // Fase 0: the legacy e-mail invitation screen is retired. New sellers and
    // other internal users are provisioned through the centralized user flow,
    // which does not send Supabase Auth invitation e-mails.
    throw redirect({ to: "/admin/usuarios" });
  },
  component: () => null,
});
