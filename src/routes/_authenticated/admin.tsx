import { useState } from "react";
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Search, ShieldAlert, Store } from "lucide-react";
import { AdminCommandPalette } from "@/components/admin/AdminCommandPalette";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { activeTenant, environmentLabel, fetchAccessContext, useAccessContext } from "@/lib/access";
import { canViewModule } from "@/lib/permissions";
import { adminPermissionForPath, visibleModules } from "@/lib/admin-modules";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });

    const context = await fetchAccessContext();
    if (context.organizations.length > 0 || context.tenants.length > 0) return;

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const isStaff = (roles ?? []).some((role) => role.role === "admin" || role.role === "gerente");
    if (!isStaff) throw redirect({ to: "/ativacao" });
  },
  component: AdminLayout,
});

function AdminSidebar() {
  const { isAdmin, isStaff, permissions } = useSession();
  const { data: access } = useAccessContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tenant = activeTenant(access);
  const modules = visibleModules(isAdmin, permissions);
  const isActive = (to: string) =>
    to === "/admin" ? pathname === "/admin" : pathname === to || pathname.startsWith(`${to}/`);

  if (!isStaff) return null;

  return (
    <Sidebar collapsible="icon" className="border-r-border/70">
      <SidebarHeader className="border-b border-sidebar-border p-3">
        <Link to="/admin" className="flex min-h-11 items-center gap-3 rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-500 font-display text-sm font-black text-white shadow-lg shadow-blue-500/20">
            NS
          </span>
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block truncate font-display text-sm font-bold">Norte Sul</span>
            <span className="block truncate text-[11px] text-sidebar-foreground/60">Centro de operações</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" isActive={isActive("/admin")} tooltip="Visão geral">
                <Link to="/admin">
                  <LayoutDashboard aria-hidden="true" />
                  <span>Visão geral</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {modules.map((module) => (
          <SidebarGroup key={module.key} className="py-1">
            <SidebarGroupLabel>{module.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {module.shortcuts.map((shortcut) => (
                  <SidebarMenuItem key={`${module.key}-${shortcut.to}-${shortcut.label}`}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(shortcut.to)}
                      tooltip={shortcut.label}
                      className="min-h-9"
                    >
                      <Link to={shortcut.to}>
                        <shortcut.icon aria-hidden="true" />
                        <span>{shortcut.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/60 p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1">
          <span className="size-2 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/10" aria-hidden="true" />
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-xs font-semibold">{tenant?.name ?? "Norte Sul"}</span>
            <span className="block truncate text-[10px] text-sidebar-foreground/60">
              {tenant ? environmentLabel[tenant.environment] ?? tenant.environment : "Ambiente administrativo"}
            </span>
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function AdminLayout() {
  const { isAdmin, isStaff, loading, permissions } = useSession();
  const { data: access } = useAccessContext();
  const [commandOpen, setCommandOpen] = useState(false);
  const tenant = activeTenant(access);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentPermission = adminPermissionForPath(pathname);

  if (loading) return null;
  if (!isStaff) {
    return (
      <div className="container-x py-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
        <p className="mt-2">Acesso restrito.</p>
      </div>
    );
  }
  if (currentPermission && !canViewModule(permissions, currentPermission)) {
    return (
      <div className="container-x py-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
        <p className="mt-2 font-semibold">Você não tem permissão para acessar este módulo.</p>
        <p className="mt-1 text-sm text-muted-foreground">Peça ao administrador para liberar este acesso.</p>
      </div>
    );
  }

  return (
    <SidebarProvider className="admin-shell">
      <AdminSidebar />
      <SidebarInset className="admin-shell-surface min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-blue-100/80 bg-white/80 px-3 backdrop-blur-xl md:px-5">
          <SidebarTrigger className="size-10" />
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-sm font-semibold">Centro de operações</p>
            <p className="truncate text-xs text-muted-foreground">{tenant?.name ?? "Norte Sul Autopeças"}</p>
          </div>

          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="ml-auto flex min-h-10 w-full max-w-md items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3 text-sm text-muted-foreground transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:ml-4"
            aria-label="Abrir busca do painel"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Buscar no painel...</span>
            <kbd className="ml-auto hidden rounded-md border bg-background px-1.5 py-0.5 font-sans text-[10px] font-semibold sm:inline">
              Ctrl K
            </kbd>
          </button>

          {tenant && (
            <span className="hidden shrink-0 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground lg:inline-flex">
              {environmentLabel[tenant.environment] ?? tenant.environment}
            </span>
          )}
          <Link
            to="/"
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-amber-200 bg-amber-50 text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Ver loja"
            title="Ver loja"
          >
            <Store className="h-4 w-4" aria-hidden="true" />
          </Link>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </SidebarInset>
      <AdminCommandPalette open={commandOpen} onOpenChange={setCommandOpen} isAdmin={isAdmin} permissions={permissions} />
    </SidebarProvider>
  );
}
