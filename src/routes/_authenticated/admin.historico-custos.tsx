import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Archive, BadgeDollarSign, Boxes, CheckCircle2, LockKeyhole, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { listProductCostHistory } from "@/lib/supplies.functions";
import { closeInventoryPeriod, getInventoryFinancialPosition, listInventoryClosings } from "@/lib/inventory-financial.functions";
import { brl } from "@/lib/format";
import { formatDate, num, qty } from "@/lib/supplies-ui";

export const Route = createFileRoute("/_authenticated/admin/historico-custos")({
  head: () => ({ meta: [{ title: "Financeiro do estoque · Admin" }, { name: "description", content: "Custo médio, valorização e fechamento mensal do estoque." }] }),
  component: () => <SupplyGuard><InventoryFinancialPage /></SupplyGuard>,
});

const sourceLabel: Record<string, string> = { goods_receipt: "Recebimento", goods_receipt_reversal: "Estorno", manual: "Ajuste manual" };
const monthEnd = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
};

function Metric({ label, value, detail, icon: Icon, tone = "primary" }: any) {
  const tones: Record<string, string> = {
    primary: "from-primary/15 to-primary/5 text-primary",
    good: "from-emerald-500/15 to-emerald-500/5 text-emerald-700",
    warn: "from-amber-500/20 to-amber-500/5 text-amber-700",
    danger: "from-red-500/15 to-red-500/5 text-red-700",
  };
  return <div className={`rounded-2xl border bg-gradient-to-br p-4 ${tones[tone]}`}>
    <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-wide">{label}</span><Icon className="h-5 w-5" /></div>
    <div className="mt-3 font-display text-2xl font-bold text-foreground">{value}</div>
    <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
  </div>;
}

function InventoryFinancialPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState(monthEnd());
  const positionFn = useServerFn(getInventoryFinancialPosition);
  const historyFn = useServerFn(listProductCostHistory);
  const closingsFn = useServerFn(listInventoryClosings);
  const closeFn = useServerFn(closeInventoryPeriod);

  const position = useQuery({ queryKey: ["inventory-financial-position"], queryFn: () => positionFn() });
  const history = useQuery({ queryKey: ["product-cost-history", search], queryFn: () => historyFn({ data: { search } }) });
  const closings = useQuery({ queryKey: ["inventory-closings"], queryFn: () => closingsFn() });
  const closePeriod = useMutation({
    mutationFn: () => closeFn({ data: { periodDate: period } }),
    onSuccess: (result) => {
      toast.success(result?.already_closed ? "Este período já estava fechado" : "Fechamento do estoque concluído");
      qc.invalidateQueries({ queryKey: ["inventory-closings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const p = position.data;
  const coverage = p?.products_with_stock ? Math.round((num(p.valued_products) / num(p.products_with_stock)) * 100) : 0;
  const rows = (history.data ?? []) as any[];

  return <div className="mx-auto max-w-7xl space-y-7">
    <header className="rounded-3xl border bg-gradient-to-br from-primary/12 via-card to-amber-500/10 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary"><BadgeDollarSign className="h-4 w-4" /> BASE FINANCEIRA</div>
          <h1 className="font-display text-3xl font-bold">Valor real do estoque</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Custo médio ponderado, cobertura de custos, divergências e fotografia mensal auditável.</p>
        </div>
        <div className="rounded-2xl border bg-background/80 p-3"><div className="text-xs font-bold uppercase text-muted-foreground">Cobertura de custo</div><div className="mt-1 text-2xl font-bold">{coverage}%</div></div>
      </div>
    </header>

    {position.isError && <div role="alert" className="rounded-xl border border-destructive bg-destructive/5 p-4 text-sm">{(position.error as Error).message}</div>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Estoque a custo" value={p ? brl(num(p.inventory_value)) : "—"} detail="Valor contábil com custo conhecido" icon={Archive} tone="primary" />
      <Metric label="Receita potencial" value={p ? brl(num(p.potential_revenue)) : "—"} detail="Saldo atual pelo preço B2C" icon={TrendingUp} tone="good" />
      <Metric label="Sem custo" value={p ? qty(num(p.missing_cost_products)) : "—"} detail="Produtos com saldo ainda não valorizado" icon={AlertTriangle} tone={num(p?.missing_cost_products) ? "warn" : "good"} />
      <Metric label="Divergências" value={p ? qty(num(p.stock_divergence_products)) : "—"} detail="Cadastro versus saldo por depósito" icon={Boxes} tone={num(p?.stock_divergence_products) ? "danger" : "good"} />
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-primary" /><h2 className="font-display text-xl font-bold">Fechamento mensal</h2></div>
        <p className="mt-1 text-sm text-muted-foreground">Grava uma fotografia imutável de quantidade, custo médio e valor por produto e depósito.</p>
        <div className="mt-4 flex flex-wrap gap-2"><Input type="date" className="w-48" value={period} onChange={(e) => setPeriod(e.target.value)} /><Button disabled={closePeriod.isPending || !period} onClick={() => closePeriod.mutate()}>{closePeriod.isPending ? "Fechando…" : "Fechar período"}</Button></div>
        <p className="mt-3 text-xs text-muted-foreground">Somente proprietário, administrador ou gerente. Repetir o comando não duplica o fechamento.</p>
      </div>
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="font-display text-xl font-bold">Últimos fechamentos</h2>
        <div className="mt-3 space-y-2">
          {(closings.data ?? []).slice(0, 4).map((row: any) => <div key={row.id} className="flex items-center justify-between rounded-xl bg-muted/50 p-3 text-sm"><div><div className="font-semibold">{formatDate(row.period_date)}</div><div className="text-xs text-muted-foreground">{row.products_count} produtos · {row.missing_cost_products} sem custo</div></div><div className="font-bold">{brl(num(row.inventory_value))}</div></div>)}
          {!closings.isLoading && (closings.data ?? []).length === 0 && <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> Nenhum período fechado ainda.</div>}
        </div>
      </div>
    </section>

    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-xl font-bold">Trilha de custos</h2><p className="text-sm text-muted-foreground">Recebimentos e estornos com custo anterior e posterior.</p></div><Input className="w-full sm:w-80" placeholder="Produto, SKU ou código" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {history.isError && <div role="alert" className="rounded-xl border border-destructive bg-destructive/5 p-4 text-sm">{(history.error as Error).message}</div>}
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="p-3 text-left">Produto</th><th className="p-3 text-left">Origem</th><th className="p-3 text-right">Qtd.</th><th className="p-3 text-right">Custo</th><th className="p-3 text-right">Médio (antes → depois)</th><th className="p-3 text-right">Data</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="p-3"><div className="font-semibold">{row.product?.name ?? "Produto"}</div><div className="text-xs text-muted-foreground">{[row.product?.internal_code, row.product?.manufacturer_code, row.product?.sku].filter(Boolean).join(" · ")}</div></td><td className="p-3">{sourceLabel[row.source] ?? row.source}</td><td className="p-3 text-right">{qty(row.qty)}</td><td className="p-3 text-right">{brl(num(row.unit_cost))}</td><td className="p-3 text-right">{row.previous_average_cost == null ? "—" : brl(num(row.previous_average_cost))} → <strong>{row.new_average_cost == null ? "—" : brl(num(row.new_average_cost))}</strong></td><td className="p-3 text-right">{formatDate(row.created_at)}</td></tr>)}</tbody>
        </table>
        {!history.isLoading && rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nenhum movimento de custo registrado.</p>}
      </div>
    </section>
  </div>;
}
