import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Users, ShoppingBag, Wand2, LayoutDashboard } from "lucide-react";

export const Route = createFileRoute("/_authenticated/vendedor")({
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const list = (roles ?? []).map((r) => r.role);
    const allowed = list.includes("vendedor") || list.includes("admin") || list.includes("gerente");
    if (!allowed) throw redirect({ to: "/" });
  },
  component: VendedorLayout,
});

function VendedorLayout() {
  return (
    <div className="container-x py-6">
      <h1 className="mb-4 font-display text-3xl font-bold uppercase">Área do Vendedor</h1>
      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <nav className="space-y-1 text-sm">
          {[
            { to: "/vendedor", label: "Painel", icon: LayoutDashboard, exact: true },
            { to: "/vendedor/clientes", label: "Meus clientes", icon: Users },
            { to: "/vendedor/pedido-assistido", label: "Pedido assistido", icon: Wand2 },
            { to: "/vendedor/meus-pedidos", label: "Meus pedidos", icon: ShoppingBag },
          ].map((t) => (
            <Link
              key={t.to}
              to={t.to as never}
              activeOptions={{ exact: t.exact }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted [&.active]:bg-primary [&.active]:text-primary-foreground"
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </Link>
          ))}
        </nav>
        <div><Outlet /></div>
      </div>
    </div>
  );
}
