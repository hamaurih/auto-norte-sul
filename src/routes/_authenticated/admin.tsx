import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { fetchAccessContext } from "@/lib/access";
import {
  LayoutDashboard,
  Users,
  UserCog,
  Briefcase,
  ShoppingBag,
  Package,
  FolderTree,
  Tag,
  Percent,
  Ticket,
  Image as ImageIcon,
  RefreshCcw,
  Bot,
  Settings,
  ShieldAlert,
  Network,
  Building2,
  Warehouse,
  FileText,
  ClipboardCheck,
  ScanLine,
  Truck,
  ShoppingCart,
  PackageCheck,
  FileUp,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });

    // Membership decides access. An authenticated user without any membership
    // goes to the activation screen, never to a generic error or a loop.
    const context = await fetchAccessContext();
    if (context.organizations.length > 0 || context.tenants.length > 0) return;

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const isStaff = (roles ?? []).some((r) => r.role === "admin" || r.role === "gerente");
    if (!isStaff) throw redirect({ to: "/ativacao" });
  },
  component: AdminLayout,
});

type Item = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  group: "operacao" | "catalogo" | "estoque" | "suprimentos" | "marketing" | "integracoes" | "sistema";
  adminOnly?: boolean;
};

const items: Item[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, group: "operacao" },
  { to: "/admin/pdv", label: "PDV", icon: ScanLine, group: "operacao" },
  { to: "/admin/orcamentos", label: "Orçamentos", icon: FileText, group: "operacao" },
  { to: "/admin/pedidos", label: "Pedidos", icon: ShoppingBag, group: "operacao" },
  { to: "/admin/cadastros-b2b", label: "Cadastros B2B", icon: Briefcase, group: "operacao" },
  { to: "/admin/clientes", label: "Clientes", icon: Users, group: "operacao" },
  { to: "/admin/vendedores", label: "Vendedores", icon: UserCog, group: "operacao", adminOnly: true },

  { to: "/admin/produtos", label: "Produtos", icon: Package, group: "catalogo" },
  { to: "/admin/categorias", label: "Categorias", icon: FolderTree, group: "catalogo" },
  { to: "/admin/marcas", label: "Marcas", icon: Tag, group: "catalogo" },

  { to: "/admin/filiais", label: "Filiais e Depósitos", icon: Building2, group: "estoque" },
  { to: "/admin/estoque", label: "Estoque", icon: Warehouse, group: "estoque" },

  { to: "/admin/suprimentos", label: "Suprimentos", icon: Truck, group: "suprimentos" },
  { to: "/admin/fornecedores", label: "Fornecedores", icon: Truck, group: "suprimentos" },
  { to: "/admin/pedidos-compra", label: "Pedidos de compra", icon: ShoppingCart, group: "suprimentos" },
  { to: "/admin/recebimentos", label: "Recebimentos", icon: PackageCheck, group: "suprimentos" },
  { to: "/admin/nfe-importacao", label: "Importar XML NF-e", icon: FileUp, group: "suprimentos" },
  { to: "/admin/historico-custos", label: "Histórico de custo", icon: FileText, group: "suprimentos" },

  { to: "/admin/promocoes", label: "Promoções", icon: Percent, group: "marketing" },
  { to: "/admin/cupons", label: "Cupons", icon: Ticket, group: "marketing" },
  { to: "/admin/banners", label: "Banners", icon: ImageIcon, group: "marketing" },

  { to: "/admin/ecossistema", label: "Ecossistema", icon: Network, group: "integracoes", adminOnly: true },
  { to: "/admin/ecossistema/bling", label: "Bling", icon: RefreshCcw, group: "integracoes", adminOnly: true },
  { to: "/admin/ia-aes-business", label: "IA A&S Business", icon: Bot, group: "integracoes", adminOnly: true },

  { to: "/admin/saneamento", label: "Saneamento", icon: ShieldAlert, group: "sistema", adminOnly: true },
  { to: "/admin/revisao-codigos", label: "Revisão de códigos", icon: Tag, group: "sistema", adminOnly: true },
  { to: "/admin/saneamento/aliases", label: "Aliases", icon: Tag, group: "sistema", adminOnly: true },
  { to: "/admin/auditoria", label: "Auditoria", icon: ClipboardCheck, group: "sistema", adminOnly: true },
  { to: "/admin/homologacao", label: "Homologação", icon: ClipboardCheck, group: "sistema", adminOnly: true },
  { to: "/admin/configuracoes", label: "Configurações", icon: Settings, group: "sistema", adminOnly: true },
];

const groupLabels: Record<Item["group"], string> = {
  operacao: "Comercial",
  catalogo: "Catálogo",
  estoque: "Estoque",
  suprimentos: "Suprimentos",
  marketing: "Marketing",
  integracoes: "Integrações",
  sistema: "Sistema",
};

function AdminSidebar() {
  const { isAdmin, isStaff } = useSession();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!isStaff) return null;

  const visible = items.filter((i) => !i.adminOnly || isAdmin);
  const groups = ["operacao", "catalogo", "estoque", "suprimentos", "marketing", "integracoes", "sistema"] as const;

  const isActive = (to: string) => (to === "/admin" ? pathname === "/admin" : pathname.startsWith(to));

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {groups.map((g) => {
          const gItems = visible.filter((i) => i.group === g);
          if (gItems.length === 0) return null;
          return (
            <SidebarGroup key={g}>
              <SidebarGroupLabel>{groupLabels[g]}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {gItems.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={isActive(item.to)}>
                        <Link to={item.to} className="flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.label}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}

function AdminLayout() {
  const { isStaff, loading } = useSession();

  if (loading) return null;
  if (!isStaff) {
    return (
      <div className="container-x py-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
        <p className="mt-2">Acesso restrito.</p>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-border bg-card px-3">
            <SidebarTrigger />
            <span className="font-display text-sm font-bold uppercase">Painel Administrativo</span>
            <Link to="/" className="ml-auto text-xs font-semibold uppercase text-muted-foreground hover:text-foreground">
              ← Voltar à loja
            </Link>
          </header>
          <main className="p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
