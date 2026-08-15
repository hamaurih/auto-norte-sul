import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Boxes, Building2, Clock3, PackageCheck } from "lucide-react";
import { stockOverview, listMovements } from "@/lib/inventory.functions";

export const Route = createFileRoute("/_authenticated/admin/estoque")({
  head: () => ({ meta: [{ title: "Estoque · Admin" }] }),
  component: EstoquePage,
});

const branchToneStyles = [
  "from-blue-500/12 via-background to-cyan-400/8 border-blue-200/70",
  "from-violet-500/12 via-background to-fuchsia-400/8 border-violet-200/70",
  "from-emerald-500/12 via-background to-lime-400/8 border-emerald-200/70",
];

function EstoquePage() {
  const ovFn = useServerFn(stockOverview);
  const mvFn = useServerFn(listMovements);
  const overview = useQuery({ queryKey: ["stock-overview"], queryFn: () => ovFn() });
  const movs = useQuery({ queryKey: ["stock-movements"], queryFn: () => mvFn({ data: { limit: 50 } }) });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="admin-page-hero">
        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-600/10 px-3 py-1 text-xs font-extrabold text-blue-700">
              <Boxes className="h-3.5 w-3.5" />
              Controle por unidade
            </span>
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Estoque por filial
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Visão rápida das quantidades disponíveis, reservas e movimentações recentes.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-blue-200/70 bg-white/75 px-4 py-3 text-sm text-blue-800 shadow-sm backdrop-blur">
            <PackageCheck className="h-5 w-5" />
            <span className="font-bold">{overview.data?.length ?? 0} unidades monitoradas</span>
          </div>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(overview.data ?? []).map((r, index) => (
          <article
            key={r.branch.id}
            className={`group rounded-3xl border bg-gradient-to-br p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${branchToneStyles[index % branchToneStyles.length]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/80 text-blue-700 shadow-sm">
                <Building2 className="h-5 w-5" />
              </div>
              {r.branch.is_main && (
                <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-white">
                  MATRIZ
                </span>
              )}
            </div>
            <h2 className="mt-4 font-display text-lg font-extrabold">{r.branch.name}</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white/70 p-3 text-center">
                <div className="text-[10px] font-bold text-muted-foreground">SKUs</div>
                <div className="mt-1 text-xl font-extrabold">{r.skus}</div>
              </div>
              <div className="rounded-2xl bg-white/70 p-3 text-center">
                <div className="text-[10px] font-bold text-muted-foreground">Em mãos</div>
                <div className="mt-1 text-xl font-extrabold text-emerald-700">{r.total_on_hand}</div>
              </div>
              <div className="rounded-2xl bg-white/70 p-3 text-center">
                <div className="text-[10px] font-bold text-muted-foreground">Reservado</div>
                <div className="mt-1 text-xl font-extrabold text-orange-600">{r.total_reserved}</div>
              </div>
            </div>
          </article>
        ))}
        {overview.isLoading && (
          <div className="rounded-3xl border border-dashed border-blue-200 bg-blue-50/50 p-8 text-center text-sm text-muted-foreground">
            Carregando unidades…
          </div>
        )}
      </div>

      <section className="overflow-hidden rounded-3xl border border-violet-200/70 bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-violet-500/10 via-blue-500/5 to-transparent px-5 py-4">
          <div>
            <span className="text-xs font-extrabold text-violet-700">HISTÓRICO OPERACIONAL</span>
            <h2 className="mt-1 font-display text-xl font-extrabold">Últimas movimentações</h2>
          </div>
          <Clock3 className="h-6 w-6 text-violet-600" />
        </div>
        {(movs.data ?? []).length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
        ) : (
          <ul className="divide-y divide-border/70 text-sm">
            {movs.data!.map((m: any) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-5 py-3 transition-colors hover:bg-blue-50/60">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
                  m.type === "IN" ? "bg-emerald-100 text-emerald-700" :
                  m.type === "OUT" ? "bg-rose-100 text-rose-700" :
                  "bg-violet-100 text-violet-700"
                }`}>{m.type}</span>
                <span className="font-extrabold">{m.qty}</span>
                <span>{m.product?.name} <span className="text-xs text-muted-foreground">({m.product?.sku})</span></span>
                <span className="text-xs text-muted-foreground">@ {m.warehouse?.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("pt-BR")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="rounded-2xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
        Para ajustar o estoque de um produto específico, use a página do produto. O estoque legado em <code>products.stock</code> continua funcionando; a nova estrutura é aditiva.
      </p>
    </div>
  );
}
