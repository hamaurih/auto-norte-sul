import { Link } from "@tanstack/react-router";
import { CheckCircle2, Briefcase, PackageX } from "lucide-react";
import type { AdminOverview } from "@/lib/admin-overview";

export function AdminAttention({ data, loading }: { data?: AdminOverview; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-16 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const pending = data?.b2bPending ?? 0;
  const low = data?.lowStock ?? [];
  const nothing = pending === 0 && low.length === 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-display text-lg font-bold uppercase">Atenção necessária</h2>

      {nothing ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
          Nenhuma pendência aberta no momento.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {pending > 0 && (
            <Link
              to="/admin/cadastros-b2b"
              className="flex min-h-11 items-start gap-3 rounded-md border border-primary bg-primary/5 p-3 text-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="block font-semibold">
                  {pending} {pending === 1 ? "cadastro B2B aguardando" : "cadastros B2B aguardando"} análise
                </span>
                <span className="block text-xs text-muted-foreground">Revisar e aprovar revendas</span>
              </span>
            </Link>
          )}

          {low.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <PackageX className="h-4 w-4 text-hot" aria-hidden="true" />
                Estoque crítico
                {data?.stockSource === "products" && (
                  <span className="ml-auto text-[10px] font-normal uppercase text-muted-foreground">
                    saldo consolidado
                  </span>
                )}
              </div>
              <ul className="mt-2 text-sm">
                {low.map((row) => (
                  <li key={row.key} className="flex gap-2 border-b border-border py-1 last:border-0">
                    <span className="min-w-0 flex-1 truncate">
                      {row.name} <span className="text-xs text-muted-foreground">({row.sku})</span>
                    </span>
                    <span className={`shrink-0 font-bold ${row.stock <= 0 ? "text-destructive" : "text-hot"}`}>
                      {row.stock} un.
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                to="/admin/estoque"
                className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-wide text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Gerenciar estoque
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
