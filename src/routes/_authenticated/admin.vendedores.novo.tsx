import { createFileRoute, redirect } from "@tanstack/react-router";
import { activeTenant, fetchAccessContext } from "@/lib/access";

export const Route = createFileRoute("/_authenticated/admin/vendedores/novo")({
  head: () => ({ meta: [{ title: "Novo vendedor · Norte Sul" }] }),
  beforeLoad: async () => {
    const context = await fetchAccessContext();
    if (!context.user_id) throw redirect({ to: "/auth" });

    const tenant = activeTenant(context);
    const isStaff = Boolean(tenant && ["owner", "admin", "manager"].includes(tenant.role));
    if (!isStaff) throw redirect({ to: "/" });

    // Fase 0: the legacy e-mail invitation screen is retired. New sellers and
    // other internal users are provisioned through the centralized user flow,
    // which does not send Supabase Auth invitation e-mails.
    throw redirect({ to: "/admin/usuarios" });
  },
  component: () => null,
});