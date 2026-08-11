import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Briefcase,
  Package,
  PackageX,
  PlusCircle,
  ScanLine,
  ShoppingBag,
  Store,
  Users,
  Warehouse,
} from "lucide-react";
import { AdminAttention } from "@/components/admin/AdminAttention";
import { AdminModuleCard } from "@/components/admin/AdminModuleCard";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { adminQuickActions, visibleModules } from "@/lib/admin-modules";
import { useAdminOverview } from "@/lib/admin-overview";
import { activeTenant, environmentLabel, useAccessContext } from "@/lib/access";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Central Administrativa · Norte Sul" },
      {
        name: "description",
        content: "Centro de controle da Norte Sul: vendas, catálogo, estoque, site e integrações.",
      },
    ],
  }),
  component: AdminHome,
});

function AdminHome() {
  const { isAdmin } = useSession();
  const { data: access } = useAccessContext();
  const { data, isLoading, isError, error, refetch } = useAdminOverview();

  const tenant = activeTenant(access);
  const modules = visibleModules(isAdmin);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold uppercase leading-none">Central Administrativa</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Centro de controle da Norte Sul: escolha uma área para operar vendas, catálogo, estoque e integrações.
          </p>
          {tenant && (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-semibold">
              <span className="truncate">{tenant.name}</span>
              <span className="text-muted-foreground">
                {environmentLabel[tenant.environment] ?? tenant.environment}
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/pdv"
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ScanLine className="h-4 w-4" aria-hidden="true" /> Abrir PDV
          </Link>
          <Link
            to="/admin/produtos/novo"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PlusCircle className="h-4 w-4" aria-hidden="true" /> Novo produto
          </Link>
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Store className="h-4 w-4" aria-hidden="true" /> Ver loja
          </Link>
        </div>
      </header>

      {isError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
          Não foi possível carregar os indicadores: {(error as Error)?.message ?? "erro desconhecido"}.
          <button
            type="button"
            onClick={() => void refetch()}
            className="ml-2 font-semibold uppercase text-primary hover:underline"
          >
            Tentar novamente
          </button>
        </div>
      )}
      {!isError && data?.partial && (
        <p role="status" className="text-xs text-muted-foreground">
          Alguns indicadores não estão disponíveis com as permissões atuais.
        </p>
      )}

      <section aria-label="Indicadores operacionais" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <AdminStatCard label="Pedidos" value={data?.orders ?? null} to="/admin/pedidos" icon={ShoppingBag} loading={isLoading} />
        <AdminStatCard label="Produtos" value={data?.products ?? null} to="/admin/produtos" icon={Package} loading={isLoading} />
        <AdminStatCard label="Clientes" value={data?.customers ?? null} to="/admin/clientes" icon={Users} loading={isLoading} />
        <AdminStatCard
          label="B2B pendentes"
          value={data?.b2bPending ?? null}
          to="/admin/cadastros-b2b"
          icon={Briefcase}
          loading={isLoading}
          hot
        />
        <AdminStatCard
          label="Estoque crítico"
          value={data?.criticalStock ?? null}
          to="/admin/estoque"
          icon={Warehouse}
          loading={isLoading}
          hint="abaixo de 5 unidades"
        />
        <AdminStatCard
          label="Sem estoque"
          value={data?.outOfStock ?? null}
          to="/admin/estoque"
          icon={PackageX}
          loading={isLoading}
        />
      </section>

      <AdminAttention data={data} loading={isLoading} />

      <section aria-label="Módulos administrativos">
        <h2 className="mb-3 font-display text-xl font-bold uppercase">Módulos</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <AdminModuleCard key={module.key} module={module} />
          ))}
        </div>
      </section>

      <section aria-label="Ações rápidas">
        <h2 className="mb-3 font-display text-xl font-bold uppercase">Ações rápidas</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {adminQuickActions.map((action) => (
            <Link
              key={action.label}
              to={action.to}
              className="flex min-h-20 flex-col items-start justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm font-semibold transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <action.icon className="h-5 w-5 text-primary" aria-hidden="true" />
              <span className="min-w-0">{action.label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
