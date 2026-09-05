import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Briefcase,
  Package,
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

const quickActionStyles = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-cyan-100 text-cyan-700",
  "bg-rose-100 text-rose-700",
] as const;

const roleLabel: Record<string, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedor",
  consulta: "Consulta",
};

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Central de Comando · Norte Sul" },
      {
        name: "description",
        content: "Central operacional da Norte Sul: prioridades, indicadores e acessos rápidos do ERP.",
      },
    ],
  }),
  component: AdminHome,
});

function AdminHome() {
  const { isAdmin, permissions, user, systemRole } = useSession();
  const { data: access } = useAccessContext();
  const { data, isLoading, isError, error, refetch } = useAdminOverview();
  const tenant = activeTenant(access);
  const modules = visibleModules(isAdmin, permissions);

  const rawName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Equipe Norte Sul";
  const firstName = String(rawName).trim().split(/\s+/)[0] || "Equipe";

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-200/80">
                <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]" />
                Sistema operacional
              </span>
              {tenant && (
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200/80">
                  {tenant.name} · {environmentLabel[tenant.environment] ?? tenant.environment}
                </span>
              )}
              <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 ring-1 ring-blue-100">
                {roleLabel[systemRole] ?? systemRole}
              </span>
            </div>

            <p className="mt-5 text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">Central de comando</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Olá, {firstName}. O que precisa de atenção agora?
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500 sm:text-base">
              Indicadores, prioridades e atalhos do ambiente ativo em uma única tela. As áreas completas continuam disponíveis abaixo e no menu lateral.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[430px]">
            <Link
              to="/admin/pdv"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <ScanLine className="h-5 w-5" aria-hidden="true" /> Abrir PDV
            </Link>
            <Link
              to="/admin/pedidos"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <ShoppingBag className="h-5 w-5" aria-hidden="true" /> Pedidos
            </Link>
            <Link
              to="/"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Store className="h-5 w-5" aria-hidden="true" /> Loja
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

      <section aria-labelledby="overview-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-500">Visão operacional</p>
            <h2 id="overview-title" className="mt-1 text-2xl font-black text-slate-950">Resumo do ambiente</h2>
          </div>
          <span className="hidden text-xs font-semibold text-slate-400 sm:block">Dados da conta ativa</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <AdminStatCard label="Pedidos" value={data?.orders ?? null} to="/admin/pedidos" icon={ShoppingBag} loading={isLoading} tone="blue" />
          <AdminStatCard label="Produtos" value={data?.products ?? null} to="/admin/produtos" icon={Package} loading={isLoading} tone="violet" />
          <AdminStatCard label="Clientes" value={data?.customers ?? null} to="/admin/clientes" icon={Users} loading={isLoading} tone="emerald" />
          <AdminStatCard label="Estoque crítico" value={data?.criticalStock ?? null} to="/admin/estoque" icon={Warehouse} loading={isLoading} hint="abaixo de 5 unidades" tone="amber" />
          <AdminStatCard label="B2B pendentes" value={data?.b2bPending ?? null} to="/admin/cadastros-b2b" icon={Briefcase} loading={isLoading} hot tone="rose" />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <AdminAttention data={data} loading={isLoading} />

        <section aria-labelledby="quick-actions-title" className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-500">Acesso direto</p>
            <h2 id="quick-actions-title" className="mt-1 text-xl font-black text-slate-950">Ações rápidas</h2>
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-1">
            {adminQuickActions.map((action, index) => (
              <Link
                key={action.label}
                to={action.to}
                className="group flex min-h-14 items-center gap-3 rounded-2xl border border-transparent px-3 py-2 text-sm transition hover:border-slate-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${quickActionStyles[index]}`}>
                  <action.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold text-slate-900">{action.label}</span>
                  {action.description && <span className="block truncate text-xs text-slate-500">{action.description}</span>}
                </span>
                <ArrowUpRight className="h-4 w-4 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="modules-title" className="pb-3">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">Ecossistema Norte Sul</p>
            <h2 id="modules-title" className="mt-1 text-2xl font-black text-slate-950">Áreas da empresa</h2>
            <p className="mt-1 text-sm text-slate-500">Entre em uma área apenas quando precisar das ferramentas específicas daquele processo.</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500">{modules.length} áreas disponíveis</span>
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
