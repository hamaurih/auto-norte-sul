import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/ecossistema")({
  head: () => ({ meta: [{ title: "Ecossistema de Integrações · Admin" }] }),
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/admin" });
  },
  component: () => (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link to="/admin/ecossistema" className="font-display text-2xl font-bold uppercase">
          Ecossistema de Integrações
        </Link>
      </div>
      <Outlet />
    </div>
  ),
});
