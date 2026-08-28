import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Package,
  PackageCheck,
  PackageX,
  ScanLine,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import { AdminAttention } from "@/components/admin/AdminAttention";
import { AdminModuleCard } from "@/components/admin/AdminModuleCard";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { adminPermissionForPath, adminQuickActions, visibleModules } from "@/lib/admin-modules";
import { useAdminOverview } from "@/lib/admin-overview";
import { activeTenant, environmentLabel, useAccessContext } from "@/lib/access";
import { canViewModule } from "@/lib/permissions";
import { useSession } from "@/lib/session";

const dailyFlow = [
  {
    step: "01",
    label: "Vender",
    description: "PDV rápido e pedidos",
    to: "/admin/pdv",
    icon: ScanLine,
    tone: "from-blue-500 to-indigo-600",
    glow: "bg-blue-400/20",
  },
  {
    step: "02",
    label: "Comprar",
    description: "Reposição e fornecedores",
    to: "/admin/reposicao",
    icon: ShoppingCart,
    tone: "from-amber-400 to-orange-500",
    glow: "bg-amber-400/20",
  },
  {
    step: "03",
    label: "Receber",
    description: "Entrada e conferência",
    to: "/admin/recebimentos",
    icon: PackageCheck,
    tone: "from-emerald-500 to-teal-600",
    glow: "bg-emerald-400/20",
  },
  {
    step: "04",
    label: "Separar",
    description: "Expedição e rastreio",
    to: "/admin/expedicao",
    icon: Truck,
    tone: "from-violet-500 to-fuchsia-600",
    glow: "bg-violet-400/20",
  },
  {
    step: "05",
    label: "Acompanhar",
    description: "Indicadores e margem",
    to: "/admin/inteligencia-comercial",
    icon: ClipboardCheck,
    tone: "from-cyan-500 to-blue-600",
    glow: "bg-cyan-400/20",
    adminOnly: true,
  },
] as const;

const quickActionStyles = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-cyan-100 text-cyan-700",
  "bg-rose-100 text-rose-700",
] as const;

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Centro de Operações · Norte Sul" },
      {
        name: "description",
        content: "Centro operacional da Norte Sul: venda, compra, recebimento, expedição e gestão.",
      },
    ],
  }),
  component: AdminHome,
});

function AdminHome() {
  const { isAdmin, permissions } = useSession();
  const { data: access } = useAccessContext();
  const { data, isLoading, isError, error, refetch } = useAdminOverview();
  const tenant = activeTenant(access);
  const modules = visibleModules(isAdmin, permissions);
  const flow = dailyFlow.filter((item) => (!("adminOnly" in item) || !item.adminOnly || isAdmin) && (!adminPermissionForPath(item.to) || canViewModule(permissions, adminPermissionForPath(item.to)!)));

  return (
    <div className="mx-auto max-w-[1500px] space-y-7">
      <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-5 py-6 text-white shadow-2xl shadow-blue-950/15 md:px-8 md:py-8">
        <div className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-blue-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 size-72 rounded-full bg-violet-500/25 blur-3xl" />
        <div className="pointer-events-none absolute right-1/4 top-0 size-40 rounded-full bg-amber-300/15 blur-3xl" />

        <div className="relative grid gap-7 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white/85 backdrop-blur">
                <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.14)]" />
                Sistema operacional
              </span>
              {tenant && (
                <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs text-white/65">
                  {tenant.name} · {environmentLabel[tenant.environment] ?? tenant.environment}
                </span>
              )}
            </div>
            <p className="text-sm font-bold text-blue-300">CENTRO DE OPERAÇÕES</p>
            <h1 className="mt-2 max-w-3xl font-display text-3xl font-extrabold leading-[1.08] tracking-tight md:text-5xl">
              Sua empresa inteira, organizada para agir.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 md:text-base">
              Venda, compre, receba e despache com menos cliques. As prioridades aparecem primeiro; os módulos completos continuam logo abaixo.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[440px]">
            <Link
              to="/admin/pdv"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 text-sm font-black text-slate-950 shadow-lg shadow-amber-950/20 transition-all hover:-translate-y-0.5 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ScanLine className="h-5 w-5" aria-hidden="true" /> Abrir PDV
            </Link>
            <Link
              to="/admin/pedidos"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white backdrop-blur transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ShoppingBag className="h-5 w-5" aria-hidden="true" /> Pedidos
            </Link>
            <Link
              to="/"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 text-sm font-bold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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

      <section aria-labelledby="daily-flow-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-700">Comece por aqui</p>
            <h2 id="daily-flow-title" className="mt-1 font-display text-2xl font-extrabold">Fluxo diário</h2>
            <p className="mt-1 text-sm text-muted-foreground">A operação da empresa na ordem em que o trabalho acontece.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Áreas conectadas
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {flow.map((item, index) => (
            <Link
              key={item.label}
              to={item.to}
              className="group relative min-h-40 overflow-hidden rounded-3xl border border-border/70 bg-white p-4 shadow-sm transition-all hover:-translate-y-1 hover:border-violet-200 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={`pointer-events-none absolute -right-8 -top-8 size-28 rounded-full blur-2xl ${item.glow}`} />
              <div className="relative flex items-start justify-between">
                <span className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${item.tone}`}>
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-mono text-[11px] font-bold text-muted-foreground">{item.step}</span>
              </div>
              <div className="relative mt-5">
                <h3 className="font-display text-lg font-extrabold">{item.label}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
              </div>
              {index < flow.length - 1 && (
                <ArrowRight className="absolute bottom-4 right-4 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden="true" />
              )}
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="operation-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Pulso da operação</p>
            <h2 id="operation-title" className="mt-1 font-display text-2xl font-extrabold">O que precisa de atenção</h2>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:block">Dados do ambiente ativo</span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <AdminStatCard label="Pedidos" value={data?.orders ?? null} to="/admin/pedidos" icon={ShoppingBag} loading={isLoading} tone="blue" />
          <AdminStatCard label="Produtos" value={data?.products ?? null} to="/admin/produtos" icon={Package} loading={isLoading} tone="violet" />
          <AdminStatCard label="Clientes" value={data?.customers ?? null} to="/admin/clientes" icon={Users} loading={isLoading} tone="emerald" />
          <AdminStatCard label="B2B pendentes" value={data?.b2bPending ?? null} to="/admin/cadastros-b2b" icon={Briefcase} loading={isLoading} hot tone="rose" />
          <AdminStatCard label="Estoque crítico" value={data?.criticalStock ?? null} to="/admin/estoque" icon={Warehouse} loading={isLoading} hint="abaixo de 5 unidades" tone="amber" />
          <AdminStatCard label="Sem estoque" value={data?.outOfStock ?? null} to="/admin/estoque" icon={PackageX} loading={isLoading} tone="cyan" />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.8fr)]">
        <AdminAttention data={data} loading={isLoading} />

        <section aria-labelledby="quick-actions-title" className="overflow-hidden rounded-3xl border border-violet-200/70 bg-white shadow-sm">
          <div className="border-b border-border/60 bg-gradient-to-r from-violet-50 via-blue-50/70 to-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">Acesso direto</p>
                <h2 id="quick-actions-title" className="mt-1 font-display text-xl font-extrabold">Ferramentas essenciais</h2>
              </div>
              <Sparkles className="h-5 w-5 text-violet-500" aria-hidden="true" />
            </div>
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-1">
            {adminQuickActions.map((action, index) => (
              <Link
                key={action.label}
                to={action.to}
                className="group flex min-h-14 items-center gap-3 rounded-2xl border border-transparent px-3 py-2 text-sm transition-all hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={`grid size-10 shrink-0 place-items-center rounded-2xl shadow-sm ${quickActionStyles[index]}`}>
                  <action.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{action.label}</span>
                  {action.description && <span className="block truncate text-xs text-muted-foreground">{action.description}</span>}
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="modules-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Todos os recursos</p>
            <h2 id="modules-title" className="mt-1 font-display text-2xl font-extrabold">Áreas da empresa</h2>
            <p className="mt-1 text-sm text-muted-foreground">Abra uma área somente quando precisar de ferramentas mais específicas.</p>
          </div>
          <span className="rounded-full border bg-white px-3 py-1.5 text-xs font-bold text-muted-foreground">{modules.length} áreas disponíveis</span>
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
