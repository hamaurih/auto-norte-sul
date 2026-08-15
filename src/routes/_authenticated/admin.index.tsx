import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Briefcase,
  Package,
  PackageX,
  PlusCircle,
  ScanLine,
  ShoppingBag,
  Sparkles,
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
    <div className="mx-auto max-w-[1500px] space-y-7">
      <section className="relative overflow-hidden rounded-3xl bg-zinc-950 px-5 py-6 text-white shadow-xl shadow-black/10 md:px-8 md:py-8">
        <div className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full bg-primary/25 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-1/3 size-40 rounded-full bg-white/5 blur-3xl" />
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Operação inteligente
              </span>
              {tenant && (
                <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/65">
                  {tenant.name} · {environmentLabel[tenant.environment] ?? tenant.environment}
                </span>
              )}
            </div>
            <h1 className="max-w-3xl font-display text-3xl font-bold leading-tight md:text-4xl">
              Tudo o que importa para sua operação, em um só lugar.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/65 md:text-base">
              Acompanhe pendências, movimente vendas e estoque e acesse cada área sem depender de sistemas externos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/pdv"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ScanLine className="h-4 w-4" aria-hidden="true" /> Abrir PDV
            </Link>
            <Link
              to="/admin/produtos/novo"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <PlusCircle className="h-4 w-4" aria-hidden="true" /> Novo produto
            </Link>
            <Link
              to="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Store className="h-4 w-4" aria-hidden="true" /> Ver loja
            </Link>
          </div>
        </div>
      </section>

      {isError && (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          Não foi possível carregar os indicadores: {(error as Error)?.message ?? "erro desconhecido"}.
          <button type="button" onClick={() => void refetch()} className="ml-2 font-semibold text-primary hover:underline">
            Tentar novamente
          </button>
        </div>
      )}
      {!isError && data?.partial && (
        <p role="status" className="text-xs text-muted-foreground">
          Alguns indicadores não estão disponíveis com as permissões atuais.
        </p>
      )}

      <section aria-labelledby="operation-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Pulso da operação</p>
            <h2 id="operation-title" className="mt-1 font-display text-2xl font-bold">Visão geral</h2>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:block">Dados do ambiente ativo</span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <AdminStatCard label="Pedidos" value={data?.orders ?? null} to="/admin/pedidos" icon={ShoppingBag} loading={isLoading} />
          <AdminStatCard label="Produtos" value={data?.products ?? null} to="/admin/produtos" icon={Package} loading={isLoading} />
          <AdminStatCard label="Clientes" value={data?.customers ?? null} to="/admin/clientes" icon={Users} loading={isLoading} />
          <AdminStatCard label="B2B pendentes" value={data?.b2bPending ?? null} to="/admin/cadastros-b2b" icon={Briefcase} loading={isLoading} hot />
          <AdminStatCard label="Estoque crítico" value={data?.criticalStock ?? null} to="/admin/estoque" icon={Warehouse} loading={isLoading} hint="abaixo de 5 unidades" />
          <AdminStatCard label="Sem estoque" value={data?.outOfStock ?? null} to="/admin/estoque" icon={PackageX} loading={isLoading} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
        <AdminAttention data={data} loading={isLoading} />
        <section aria-labelledby="quick-actions-title" className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Atalhos</p>
              <h2 id="quick-actions-title" className="mt-1 font-display text-xl font-bold">Mais usados</h2>
            </div>
            <ArrowUpRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {adminQuickActions.slice(0, 5).map((action) => (
              <Link
                key={action.label}
                to={action.to}
                className="group flex min-h-11 items-center gap-3 rounded-xl border border-transparent bg-muted/55 px-3 py-2 text-sm font-semibold transition-all hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-primary shadow-sm">
                  <action.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="modules-title">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Espaços de trabalho</p>
          <h2 id="modules-title" className="mt-1 font-display text-2xl font-bold">Áreas da empresa</h2>
          <p className="mt-1 text-sm text-muted-foreground">Recursos organizados conforme o fluxo real da operação.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {modules.map((module) => (
            <AdminModuleCard key={module.key} module={module} />
          ))}
        </div>
      </section>
    </div>
  );
}
