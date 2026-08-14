import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CircleDollarSign, Save, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listCommercialIntelligence, upsertProductPricingSetting } from "@/lib/supplies.functions";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/inteligencia-comercial")({
  head: () => ({
    meta: [
      { title: "Inteligência comercial · Admin" },
      { name: "description", content: "Curva ABC, margem, markup e formação de preço." },
    ],
  }),
  component: GuardedPage,
});

type PricingEdit = {
  productId: string;
  productName: string;
  tax: string;
  commission: string;
  paymentFee: string;
  otherRate: string;
  fixedCost: string;
  desiredMargin: string;
  rounding: "none" | "x90" | "x99" | "whole";
};

function GuardedPage() {
  return <SupplyGuard><CommercialIntelligencePage /></SupplyGuard>;
}

function CommercialIntelligencePage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCommercialIntelligence);
  const saveFn = useServerFn(upsertProductPricingSetting);
  const [lookbackDays, setLookbackDays] = useState(90);
  const [abcClass, setAbcClass] = useState<"A" | "B" | "C" | "all">("all");
  const [status, setStatus] = useState("all");
  const [edit, setEdit] = useState<PricingEdit | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["commercial-intelligence", lookbackDays, abcClass, status],
    queryFn: () => listFn({ data: { lookbackDays, abcClass, status } }),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!edit) throw new Error("Selecione um produto");
      const pct = (value: string) => Math.max(0, Number(value.replace(",", ".")) || 0) / 100;
      return saveFn({ data: {
        productId: edit.productId,
        taxRate: pct(edit.tax),
        commissionRate: pct(edit.commission),
        paymentFeeRate: pct(edit.paymentFee),
        otherVariableRate: pct(edit.otherRate),
        fixedCostPerUnit: Math.max(0, Number(edit.fixedCost.replace(",", ".")) || 0),
        desiredMarginRate: pct(edit.desiredMargin),
        priceRounding: edit.rounding,
      }});
    },
    onSuccess: () => {
      toast.success("Parâmetros de formação de preço atualizados");
      setEdit(null);
      qc.invalidateQueries({ queryKey: ["commercial-intelligence"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = (data ?? []) as any[];
  const summary = {
    revenue: rows.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0),
    profit: rows.reduce((sum, row) => sum + Number(row.gross_profit ?? 0), 0),
    negative: rows.filter((row) => row.pricing_status === "margem_negativa").length,
    below: rows.filter((row) => row.pricing_status === "abaixo_sugerido").length,
  };
  const overallMargin = summary.revenue > 0 ? summary.profit / summary.revenue * 100 : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase">Inteligência comercial</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Curva ABC por faturamento, rentabilidade e preço sugerido. O sistema não altera preços automaticamente.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Faturamento analisado" value={brl(summary.revenue)} icon={CircleDollarSign} />
        <Metric label="Lucro bruto estimado" value={brl(summary.profit)} icon={TrendingUp} />
        <Metric label="Margem bruta consolidada" value={`${overallMargin.toFixed(1)}%`} icon={TrendingUp} />
        <Metric label="Margem negativa/abaixo" value={String(summary.negative + summary.below)} icon={TrendingDown} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {(["all","A","B","C"] as const).map((value) => (
          <button key={value} type="button" onClick={() => setAbcClass(value)}
            className={`min-h-9 rounded-md border px-3 text-xs font-bold uppercase ${
              abcClass === value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
            }`}>
            {value === "all" ? "Todas as classes" : `Classe ${value}`}
          </button>
        ))}
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Todos os preços</option>
          <option value="margem_negativa">Margem negativa</option>
          <option value="abaixo_sugerido">Abaixo do sugerido</option>
          <option value="acima_sugerido">Acima do sugerido</option>
          <option value="sem_preco">Sem preço</option>
          <option value="adequado">Adequado</option>
        </select>
        <select className="ml-auto h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))}>
          <option value={30}>30 dias</option><option value={60}>60 dias</option>
          <option value={90}>90 dias</option><option value={180}>180 dias</option>
        </select>
      </div>

      {isError && <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
        {(error as Error)?.message ?? "Não foi possível calcular os indicadores."}
      </div>}
      {isLoading && <p className="text-sm text-muted-foreground">Calculando indicadores…</p>}

      {rows.length > 0 && <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[1150px] text-sm">
          <thead className="text-xs uppercase text-muted-foreground"><tr>
            <th className="p-3 text-left">ABC</th><th className="p-3 text-left">Produto</th>
            <th className="p-3 text-right">Unidades</th><th className="p-3 text-right">Faturamento</th>
            <th className="p-3 text-right">% acumulado</th><th className="p-3 text-right">Custo médio</th>
            <th className="p-3 text-right">Preço atual</th><th className="p-3 text-right">Margem</th>
            <th className="p-3 text-right">Markup</th><th className="p-3 text-right">Preço sugerido</th>
            <th className="p-3 text-right">Ação</th>
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.product_id} className="border-t border-border">
            <td className="p-3"><AbcBadge value={row.abc_class} /></td>
            <td className="p-3"><div className="font-semibold">{row.product_name}</div>
              <div className="text-xs text-muted-foreground">{row.sku}</div><PriceStatus value={row.pricing_status} /></td>
            <td className="p-3 text-right">{Number(row.units_sold ?? 0).toFixed(0)}</td>
            <td className="p-3 text-right">{brl(Number(row.revenue ?? 0))}</td>
            <td className="p-3 text-right">{Number(row.cumulative_revenue_pct ?? 0).toFixed(1)}%</td>
            <td className="p-3 text-right">{brl(Number(row.average_cost ?? 0))}</td>
            <td className="p-3 text-right">{brl(Number(row.current_price ?? 0))}</td>
            <td className={`p-3 text-right font-semibold ${Number(row.gross_margin_pct ?? 0) < 0 ? "text-destructive" : ""}`}>
              {row.gross_margin_pct == null ? "—" : `${Number(row.gross_margin_pct).toFixed(1)}%`}
            </td>
            <td className="p-3 text-right">{row.markup_pct == null ? "—" : `${Number(row.markup_pct).toFixed(1)}%`}</td>
            <td className="p-3 text-right font-bold">{row.suggested_price == null ? "—" : brl(Number(row.suggested_price))}</td>
            <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => setEdit({
              productId: row.product_id, productName: row.product_name,
              tax: String(Number(row.tax_rate ?? 0)*100), commission: String(Number(row.commission_rate ?? 0)*100),
              paymentFee: String(Number(row.payment_fee_rate ?? 0)*100), otherRate: String(Number(row.other_variable_rate ?? 0)*100),
              fixedCost: String(row.fixed_cost_per_unit ?? 0), desiredMargin: String(Number(row.desired_margin_rate ?? .3)*100),
              rounding: "none",
            })}>Formar preço</Button></td>
          </tr>)}</tbody>
        </table>
      </div>}

      {edit && <section className="rounded-lg border border-primary/40 bg-card p-4">
        <h2 className="font-display text-lg font-bold uppercase">Formação de preço · {edit.productName}</h2>
        <p className="text-xs text-muted-foreground">Informe percentuais em valores de 0 a 100. O resultado é apenas sugestão.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Impostos %" value={edit.tax} onChange={(value) => setEdit({...edit,tax:value})} />
          <Field label="Comissão %" value={edit.commission} onChange={(value) => setEdit({...edit,commission:value})} />
          <Field label="Taxa de pagamento %" value={edit.paymentFee} onChange={(value) => setEdit({...edit,paymentFee:value})} />
          <Field label="Outros variáveis %" value={edit.otherRate} onChange={(value) => setEdit({...edit,otherRate:value})} />
          <Field label="Custo fixo por unidade" value={edit.fixedCost} onChange={(value) => setEdit({...edit,fixedCost:value})} />
          <Field label="Margem desejada %" value={edit.desiredMargin} onChange={(value) => setEdit({...edit,desiredMargin:value})} />
          <label className="text-xs font-semibold uppercase text-muted-foreground">Arredondamento
            <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={edit.rounding} onChange={(e) => setEdit({...edit,rounding:e.target.value as PricingEdit["rounding"]})}>
              <option value="none">Centavos exatos</option><option value="x90">Final ,90</option>
              <option value="x99">Final ,99</option><option value="whole">Inteiro acima</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}><Save className="mr-2 h-4 w-4" />
            {save.isPending ? "Salvando…" : "Salvar simulação"}</Button></div>
      </section>}
    </div>
  );
}

function Field({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <label className="text-xs font-semibold uppercase text-muted-foreground">{label}
    <Input className="mt-1" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
function Metric({label,value,icon:Icon}:{label:string;value:string;icon:typeof TrendingUp}) {
  return <div className="rounded-lg border border-border bg-card p-4"><Icon className="h-5 w-5 text-primary" />
    <div className="mt-2 font-display text-2xl font-bold">{value}</div><div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div></div>;
}
function AbcBadge({value}:{value:string}) {
  const style=value==="A"?"bg-emerald-500/15 text-emerald-700":value==="B"?"bg-amber-500/15 text-amber-700":"bg-slate-500/15 text-slate-700";
  return <span className={`rounded-full px-2 py-1 text-xs font-bold ${style}`}>{value}</span>;
}
function PriceStatus({value}:{value:string}) {
  const labels:Record<string,string>={margem_negativa:"Margem negativa",abaixo_sugerido:"Abaixo do sugerido",acima_sugerido:"Acima do sugerido",sem_preco:"Sem preço",adequado:"Adequado"};
  return <span className={`mt-1 inline-block text-[10px] font-bold uppercase ${value==="margem_negativa"?"text-destructive":"text-muted-foreground"}`}>{labels[value]??value}</span>;
}
