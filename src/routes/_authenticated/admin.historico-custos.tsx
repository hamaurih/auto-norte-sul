import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { listProductCostHistory } from "@/lib/supplies.functions";
import { brl } from "@/lib/format";
import { formatDate, num, qty } from "@/lib/supplies-ui";

export const Route = createFileRoute("/_authenticated/admin/historico-custos")({
  head: () => ({
    meta: [
      { title: "Histórico de custo · Admin" },
      { name: "description", content: "Evolução do custo médio e do último custo de compra por produto." },
    ],
  }),
  component: HistoricoCustosPage,
});

const sourceLabel: Record<string, string> = {
  goods_receipt: "Recebimento",
  goods_receipt_reversal: "Estorno de recebimento",
  manual: "Ajuste manual",
};

function HistoricoCustosPage() {
  return (
    <SupplyGuard>
      <HistoricoCustos />
    </SupplyGuard>
  );
}

function HistoricoCustos() {
  const listFn = useServerFn(listProductCostHistory);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["product-cost-history", search],
    queryFn: () => listFn({ data: { search } }),
  });

  const rows = (data ?? []) as any[];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase">Histórico de custo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada linha é gerada pelas funções transacionais de recebimento e estorno — nenhum cálculo é feito
          na tela.
        </p>
      </header>

      <Input
        className="w-full sm:w-80"
        placeholder="Buscar por produto, SKU ou código"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {isError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
          {(error as Error)?.message ?? "Não foi possível carregar o histórico de custo."}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Carregando histórico…</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum movimento de custo registrado.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 text-left">Produto</th>
                <th className="p-3 text-left">Origem</th>
                <th className="p-3 text-right">Qtd.</th>
                <th className="p-3 text-right">Custo</th>
                <th className="p-3 text-right">Médio (antes → depois)</th>
                <th className="p-3 text-right">Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="p-3">
                    <div className="font-semibold">{row.product?.name ?? "Produto"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[row.product?.internal_code && `Interno: ${row.product.internal_code}`,
                        row.product?.manufacturer_code && `Fabricante: ${row.product.manufacturer_code}`,
                        row.product?.sku]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="p-3">{sourceLabel[row.source] ?? row.source}</td>
                  <td className="p-3 text-right">{qty(row.qty)}</td>
                  <td className="p-3 text-right">{brl(num(row.unit_cost))}</td>
                  <td className="p-3 text-right">
                    {row.previous_average_cost == null ? "—" : brl(num(row.previous_average_cost))} →{" "}
                    <span className="font-semibold">
                      {row.new_average_cost == null ? "—" : brl(num(row.new_average_cost))}
                    </span>
                  </td>
                  <td className="p-3 text-right">{formatDate(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
