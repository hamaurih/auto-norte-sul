import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Briefcase, CheckCircle2, PackageX } from "lucide-react";
import type { AdminOverview } from "@/lib/admin-overview";

export function AdminAttention({ data, loading }: { data?: AdminOverview; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
        <div className="h-5 w-44 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const pending = data?.b2bPending ?? 0;
  const low = data?.lowStock ?? [];
  const unavailable =
    data?.b2bPending === null ||
    data?.criticalStock === null ||
    data?.stockSource === "unavailable";
  const nothing = !unavailable && pending === 0 && low.length === 0;
  const totalKnown = pending + low.length;

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm" aria-labelledby="attention-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Prioridades</p>
          <h2 id="attention-title" className="mt-1 font-display text-xl font-bold">Central de pendências</h2>
        </div>
        {!unavailable && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${totalKnown > 0 ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}>
            {totalKnown}
          </span>
        )}
      </div>

      {unavailable && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          Parte dos alertas está indisponível com as permissões atuais; não é possível confirmar ausência de pendências.
        </p>
      )}

      {nothing ? (
        <div className="mt-4 flex min-h-24 items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-semibold">Operação em dia</span>
            <span className="block text-sm text-muted-foreground">Nenhuma pendência aberta no momento.</span>
          </span>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {pending > 0 && (
            <Link
              to="/admin/cadastros-b2b"
              className="group flex min-h-24 items-start gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] p-4 text-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Briefcase className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{pending} {pending === 1 ? "cadastro B2B" : "cadastros B2B"} aguardando análise</span>
                <span className="mt-1 block text-xs text-muted-foreground">Revisar e aprovar revendas</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          )}

          {low.length > 0 && (
            <div className="rounded-xl border border-border/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <PackageX className="h-4 w-4 text-amber-600" aria-hidden="true" />
                Estoque crítico
                {data?.stockSource === "products" && <span className="ml-auto text-[10px] font-normal text-muted-foreground">Consolidado</span>}
              </div>
              <ul className="mt-2 text-sm">
                {low.slice(0, 4).map((row) => (
                  <li key={row.key} className="flex gap-2 border-b border-border/60 py-1.5 last:border-0">
                    <span className="min-w-0 flex-1 truncate">{row.name} <span className="text-xs text-muted-foreground">({row.sku})</span></span>
                    <span className={`shrink-0 font-bold tabular-nums ${row.stock <= 0 ? "text-destructive" : "text-amber-600"}`}>{row.stock} un.</span>
                  </li>
                ))}
              </ul>
              <Link to="/admin/estoque" className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Gerenciar estoque <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
