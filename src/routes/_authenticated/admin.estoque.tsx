import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { stockOverview, listMovements } from "@/lib/inventory.functions";

export const Route = createFileRoute("/_authenticated/admin/estoque")({
  head: () => ({ meta: [{ title: "Estoque · Admin" }] }),
  component: EstoquePage,
});

function EstoquePage() {
  const ovFn = useServerFn(stockOverview);
  const mvFn = useServerFn(listMovements);
  const overview = useQuery({ queryKey: ["stock-overview"], queryFn: () => ovFn() });
  const movs = useQuery({ queryKey: ["stock-movements"], queryFn: () => mvFn({ data: { limit: 50 } }) });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold uppercase">Estoque por Filial</h1>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(overview.data ?? []).map((r) => (
          <div key={r.branch.id} className="rounded-lg border border-border bg-card p-4">
            <div className="font-display text-lg font-bold uppercase">
              {r.branch.name}
              {r.branch.is_main && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">MATRIZ</span>}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div><div className="text-[10px] uppercase text-muted-foreground">SKUs</div><div className="font-bold">{r.skus}</div></div>
              <div><div className="text-[10px] uppercase text-muted-foreground">Em mãos</div><div className="font-bold">{r.total_on_hand}</div></div>
              <div><div className="text-[10px] uppercase text-muted-foreground">Reservado</div><div className="font-bold text-hot">{r.total_reserved}</div></div>
            </div>
          </div>
        ))}
        {overview.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      </div>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold uppercase">Últimas movimentações</h2>
        <div className="rounded-lg border border-border bg-card">
          {(movs.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {movs.data!.map((m: any) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 p-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                    m.type === "IN" ? "bg-green-500/10 text-green-700" :
                    m.type === "OUT" ? "bg-red-500/10 text-red-700" :
                    "bg-muted"
                  }`}>{m.type}</span>
                  <span className="font-bold">{m.qty}</span>
                  <span>{m.product?.name} <span className="text-xs text-muted-foreground">({m.product?.sku})</span></span>
                  <span className="text-xs text-muted-foreground">@ {m.warehouse?.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("pt-BR")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Para ajustar estoque de um produto específico use a página do produto. O estoque legado em <code>products.stock</code> continua funcionando; a nova estrutura é aditiva.
      </p>
    </div>
  );
}
