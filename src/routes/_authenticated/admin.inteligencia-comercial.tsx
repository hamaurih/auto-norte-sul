import { useDeferredValue, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Gauge,
  PackageSearch,
  Save,
  Search,
  TrendingDown,
  TrendingUp,
  Truck,
  WalletCards,
} from "lucide-react";
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
      { name: "description", content: "Curva ABC, margem, estoque, giro e fornecedores." },
    ],
  }),
  component: GuardedPage,
});

type ProductRow = {
  product_id: string;
  sku: string;
  product_name: string;
  units_sold: number;
  revenue: number;
  cumulative_revenue_pct: number;
  abc_class: "A" | "B" | "C";
  average_cost: number;
  current_price: number;
  gross_profit: number;
  gross_margin_pct: number | null;
  markup_pct: number | null;
  tax_rate: number;
  commission_rate: number;
  payment_fee_rate: number;
  other_variable_rate: number;
  fixed_cost_per_unit: number;
  desired_margin_rate: number;
  price_rounding: PricingEdit["rounding"];
  suggested_price: number | null;
  pricing_status: string;
  stock_qty: number;
  stock_value: number;
  avg_daily_units: number;
  days_cover: number | null;
  no_sale_days: number | null;
  inventory_status: string;
  capital_at_risk: number;
  supplier_name: string | null;
};

type SupplierRow = {
  supplier_id: string;
  supplier_name: string;
  average_lead_days: number | null;
  receipt_count: number;
  purchased_value: number;
  rejection_rate_pct: number | null;
  on_time_rate_pct: number | null;
  performance_score: number;
};

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

const PAGE_SIZE = 50;
const INVENTORY_LABELS: Record<string, string> = {
  saudavel: "Saudável",
  risco_ruptura: "Risco de ruptura",
  sem_estoque: "Sem estoque",
  excesso: "Excesso",
  capital_parado: "Capital parado",
  sem_giro: "Sem giro",
};

function GuardedPage() {
  return (
    <SupplyGuard>
      <CommercialIntelligencePage />
    </SupplyGuard>
  );
}

function CommercialIntelligencePage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listCommercialIntelligence);
  const saveFn = useServerFn(upsertProductPricingSetting);
  const [lookbackDays, setLookbackDays] = useState(90);
  const [abcClass, setAbcClass] = useState<"A" | "B" | "C" | "all">("all");
  const [pricingStatus, setPricingStatus] = useState("all");
  const [inventoryStatus, setInventoryStatus] = useState("all");
  const [view, setView] = useState<"products" | "suppliers">("products");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<PricingEdit | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["commercial-intelligence-v2", lookbackDays, abcClass, pricingStatus, inventoryStatus],
    queryFn: () => listFn({ data: { lookbackDays, abcClass, status: pricingStatus, inventoryStatus } }),
  });

  const products = (data?.products ?? []) as ProductRow[];
  const suppliers = (data?.suppliers ?? []) as SupplierRow[];
  const filteredProducts = useMemo(() => {
    const term = deferredSearch.trim().toLocaleLowerCase("pt-BR");
    if (!term) return products;
    return products.filter((row) =>
      `${row.product_name} ${row.sku} ${row.supplier_name ?? ""}`.toLocaleLowerCase("pt-BR").includes(term),
    );
  }, [deferredSearch, products]);

  const summary = useMemo(() => {
    const revenue = products.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0);
    const profit = products.reduce((sum, row) => sum + Number(row.gross_profit ?? 0), 0);
    const stockValue = products.reduce((sum, row) => sum + Number(row.stock_value ?? 0), 0);
    const capitalAtRisk = products.reduce((sum, row) => sum + Number(row.capital_at_risk ?? 0), 0);
    const abc = { A: 0, B: 0, C: 0 };
    products.forEach((row) => {
      abc[row.abc_class] += Number(row.revenue ?? 0);
    });
    return {
      revenue,
      profit,
      stockValue,
      capitalAtRisk,
      margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      pricingAlerts: products.filter((row) => ["margem_negativa", "abaixo_sugerido", "sem_preco"].includes(row.pricing_status)).length,
      ruptureRisk: products.filter((row) => ["sem_estoque", "risco_ruptura"].includes(row.inventory_status)).length,
      abc,
    };
  }, [products]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const visibleProducts = filteredProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const save = useMutation({
    mutationFn: () => {
      if (!edit) throw new Error("Selecione um produto");
      const percentage = (value: string) => Math.max(0, Number(value.replace(",", ".")) || 0) / 100;
      return saveFn({
        data: {
          productId: edit.productId,
          taxRate: percentage(edit.tax),
          commissionRate: percentage(edit.commission),
          paymentFeeRate: percentage(edit.paymentFee),
          otherVariableRate: percentage(edit.otherRate),
          fixedCostPerUnit: Math.max(0, Number(edit.fixedCost.replace(",", ".")) || 0),
          desiredMarginRate: percentage(edit.desiredMargin),
          priceRounding: edit.rounding,
        },
      });
    },
    onSuccess: () => {
      toast.success("Parâmetros de preço atualizados");
      setEdit(null);
      void queryClient.invalidateQueries({ queryKey: ["commercial-intelligence-v2"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Decisão baseada em dados</p>
          <h1 className="mt-1 font-display text-3xl font-bold">Inteligência comercial</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Vendas do site e PDV, Curva ABC, margem, cobertura, capital imobilizado e desempenho de fornecedores.
            Sugestões nunca alteram preços automaticamente.
          </p>
        </div>
        <select
          aria-label="Período analisado"
          className="h-11 rounded-xl border border-input bg-background px-3 text-sm font-semibold"
          value={lookbackDays}
          onChange={(event) => {
            setLookbackDays(Number(event.target.value));
            setPage(1);
          }}
        >
          <option value={30}>Últimos 30 dias</option>
          <option value={60}>Últimos 60 dias</option>
          <option value={90}>Últimos 90 dias</option>
          <option value={180}>Últimos 180 dias</option>
          <option value={365}>Últimos 365 dias</option>
        </select>
      </header>

      {isError && (
        <div role="alert" className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <span className="min-w-0 flex-1">{(error as Error)?.message ?? "Não foi possível calcular os indicadores."}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      )}

      <section aria-label="Indicadores comerciais" className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
        <Metric label="Faturamento" value={brl(summary.revenue)} icon={CircleDollarSign} loading={isLoading} />
        <Metric label="Lucro bruto" value={brl(summary.profit)} icon={TrendingUp} loading={isLoading} />
        <Metric label="Margem bruta" value={`${summary.margin.toFixed(1)}%`} icon={Gauge} loading={isLoading} />
        <Metric label="Valor em estoque" value={brl(summary.stockValue)} icon={Boxes} loading={isLoading} />
        <Metric label="Capital sob risco" value={brl(summary.capitalAtRisk)} icon={WalletCards} loading={isLoading} hot={summary.capitalAtRisk > 0} />
        <Metric label="Risco de ruptura" value={String(summary.ruptureRisk)} icon={PackageSearch} loading={isLoading} hot={summary.ruptureRisk > 0} />
        <Metric label="Alertas de preço" value={String(summary.pricingAlerts)} icon={TrendingDown} loading={isLoading} hot={summary.pricingAlerts > 0} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,.6fr)]">
        <div className="rounded-3xl border border-blue-200/70 bg-gradient-to-br from-white to-blue-50 p-5 shadow-sm">
          <h2 className="font-display text-lg font-bold">Concentração do faturamento</h2>
          <p className="mt-1 text-xs text-muted-foreground">Distribuição ABC no período selecionado</p>
          <div className="mt-5 space-y-4">
            {(["A", "B", "C"] as const).map((key) => {
              const percentage = summary.revenue > 0 ? (summary.abc[key] / summary.revenue) * 100 : 0;
              return (
                <div key={key}>
                  <div className="mb-1.5 flex justify-between text-xs font-semibold">
                    <span>Classe {key}</span>
                    <span>{percentage.toFixed(1)}% · {brl(summary.abc[key])}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${key === "A" ? "bg-emerald-500" : key === "B" ? "bg-amber-500" : "bg-slate-400"}`}
                      style={{ width: `${Math.min(100, percentage)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-100 via-orange-50 to-rose-100 p-5 text-slate-900 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Leitura executiva</p>
          <h2 className="mt-1 font-display text-xl font-bold">Onde agir primeiro</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li><strong className="text-slate-900">{summary.ruptureRisk}</strong> itens podem perder vendas por falta de estoque.</li>
            <li><strong className="text-slate-900">{brl(summary.capitalAtRisk)}</strong> estão em excesso, sem giro ou parados.</li>
            <li><strong className="text-slate-900">{summary.pricingAlerts}</strong> preços exigem revisão de margem.</li>
          </ul>
        </div>
      </section>

      <div className="flex gap-2 border-b border-border">
        <ViewButton active={view === "products"} onClick={() => setView("products")} icon={Boxes} label="Produtos e rentabilidade" />
        <ViewButton active={view === "suppliers"} onClick={() => setView("suppliers")} icon={Truck} label="Ranking de fornecedores" />
      </div>

      {view === "products" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                className="h-11 rounded-xl pl-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Buscar produto, SKU ou fornecedor"
                aria-label="Buscar produtos"
              />
            </label>
            <select aria-label="Filtrar Curva ABC" className="h-11 rounded-xl border border-input bg-background px-3 text-sm" value={abcClass}
              onChange={(event) => { setAbcClass(event.target.value as typeof abcClass); setPage(1); }}>
              <option value="all">Todas as classes ABC</option><option value="A">Classe A</option><option value="B">Classe B</option><option value="C">Classe C</option>
            </select>
            <select aria-label="Filtrar situação do estoque" className="h-11 rounded-xl border border-input bg-background px-3 text-sm" value={inventoryStatus}
              onChange={(event) => { setInventoryStatus(event.target.value); setPage(1); }}>
              <option value="all">Todo o estoque</option>
              {Object.entries(INVENTORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select aria-label="Filtrar situação do preço" className="h-11 rounded-xl border border-input bg-background px-3 text-sm" value={pricingStatus}
              onChange={(event) => { setPricingStatus(event.target.value); setPage(1); }}>
              <option value="all">Todos os preços</option><option value="margem_negativa">Margem negativa</option>
              <option value="abaixo_sugerido">Abaixo do sugerido</option><option value="sem_preco">Sem preço</option><option value="adequado">Adequado</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card shadow-sm">
            <table className="w-full min-w-[1420px] text-sm">
              <thead className="bg-muted/45 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">ABC</th><th className="p-3 text-left">Produto</th>
                  <th className="p-3 text-right">Faturamento</th><th className="p-3 text-right">Margem</th>
                  <th className="p-3 text-right">Preço atual</th><th className="p-3 text-right">Sugerido</th>
                  <th className="p-3 text-right">Estoque</th><th className="p-3 text-right">Capital</th>
                  <th className="p-3 text-right">Cobertura</th><th className="p-3 text-left">Situação</th>
                  <th className="p-3 text-left">Fornecedor</th><th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((row) => (
                  <tr key={row.product_id} className="border-t border-border/60 hover:bg-muted/30">
                    <td className="p-3"><AbcBadge value={row.abc_class} /></td>
                    <td className="max-w-[280px] p-3">
                      <div className="truncate font-semibold">{row.product_name}</div>
                      <div className="text-xs text-muted-foreground">{row.sku}</div>
                      <PriceStatus value={row.pricing_status} />
                    </td>
                    <td className="p-3 text-right font-semibold">{brl(Number(row.revenue))}</td>
                    <td className={`p-3 text-right font-semibold ${Number(row.gross_margin_pct ?? 0) < 0 ? "text-destructive" : ""}`}>
                      {row.gross_margin_pct == null ? "—" : `${Number(row.gross_margin_pct).toFixed(1)}%`}
                    </td>
                    <td className="p-3 text-right">{brl(Number(row.current_price))}</td>
                    <td className="p-3 text-right font-bold">{row.suggested_price == null ? "—" : brl(Number(row.suggested_price))}</td>
                    <td className="p-3 text-right tabular-nums">{Number(row.stock_qty).toFixed(0)}</td>
                    <td className="p-3 text-right">{brl(Number(row.stock_value))}</td>
                    <td className="p-3 text-right">{row.days_cover == null ? "Sem giro" : `${Number(row.days_cover).toFixed(0)} dias`}</td>
                    <td className="p-3"><InventoryBadge value={row.inventory_status} /></td>
                    <td className="max-w-[180px] truncate p-3 text-muted-foreground">{row.supplier_name ?? "Não definido"}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => setEdit({
                        productId: row.product_id,
                        productName: row.product_name,
                        tax: String(Number(row.tax_rate ?? 0) * 100),
                        commission: String(Number(row.commission_rate ?? 0) * 100),
                        paymentFee: String(Number(row.payment_fee_rate ?? 0) * 100),
                        otherRate: String(Number(row.other_variable_rate ?? 0) * 100),
                        fixedCost: String(row.fixed_cost_per_unit ?? 0),
                        desiredMargin: String(Number(row.desired_margin_rate ?? .3) * 100),
                        rounding: row.price_rounding ?? "none",
                      })}>Formar preço</Button>
                    </td>
                  </tr>
                ))}
                {!isLoading && visibleProducts.length === 0 && (
                  <tr><td colSpan={12} className="p-10 text-center text-muted-foreground">Nenhum produto encontrado com estes filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{filteredProducts.length.toLocaleString("pt-BR")} produtos · página {page} de {pageCount}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                Próxima <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <SupplierRanking rows={suppliers} loading={isLoading} />
      )}

      {edit && (
        <section className="rounded-2xl border border-primary/35 bg-card p-5 shadow-lg">
          <h2 className="font-display text-lg font-bold">Formação de preço · {edit.productName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Percentuais entre 0 e 100. Salvar altera apenas os parâmetros da simulação.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Impostos %" value={edit.tax} onChange={(value) => setEdit({ ...edit, tax: value })} />
            <Field label="Comissão %" value={edit.commission} onChange={(value) => setEdit({ ...edit, commission: value })} />
            <Field label="Taxa de pagamento %" value={edit.paymentFee} onChange={(value) => setEdit({ ...edit, paymentFee: value })} />
            <Field label="Outros variáveis %" value={edit.otherRate} onChange={(value) => setEdit({ ...edit, otherRate: value })} />
            <Field label="Custo fixo por unidade" value={edit.fixedCost} onChange={(value) => setEdit({ ...edit, fixedCost: value })} />
            <Field label="Margem desejada %" value={edit.desiredMargin} onChange={(value) => setEdit({ ...edit, desiredMargin: value })} />
            <label className="text-xs font-semibold text-muted-foreground">Arredondamento
              <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={edit.rounding}
                onChange={(event) => setEdit({ ...edit, rounding: event.target.value as PricingEdit["rounding"] })}>
                <option value="none">Centavos exatos</option><option value="x90">Final ,90</option>
                <option value="x99">Final ,99</option><option value="whole">Inteiro acima</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              <Save className="mr-2 h-4 w-4" aria-hidden="true" />{save.isPending ? "Salvando…" : "Salvar simulação"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function SupplierRanking({ rows, loading }: { rows: SupplierRow[]; loading: boolean }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="border-b border-border/60 p-5">
        <h2 className="font-display text-xl font-bold">Desempenho dos fornecedores</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pontuação: 70% pontualidade e 30% qualidade dos itens recebidos.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-sm">
          <thead className="bg-muted/45 text-xs text-muted-foreground"><tr>
            <th className="p-3 text-left">Fornecedor</th><th className="p-3 text-right">Comprado</th>
            <th className="p-3 text-right">Recebimentos</th><th className="p-3 text-right">Lead time</th>
            <th className="p-3 text-right">No prazo</th><th className="p-3 text-right">Rejeição</th><th className="p-3 text-right">Score</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.supplier_id} className="border-t border-border/60">
              <td className="p-3 font-semibold">{row.supplier_name}</td><td className="p-3 text-right">{brl(Number(row.purchased_value))}</td>
              <td className="p-3 text-right">{row.receipt_count}</td><td className="p-3 text-right">{row.average_lead_days ?? "—"} dias</td>
              <td className="p-3 text-right">{row.on_time_rate_pct == null ? "Sem medição" : `${Number(row.on_time_rate_pct).toFixed(1)}%`}</td>
              <td className="p-3 text-right">{row.rejection_rate_pct == null ? "Sem medição" : `${Number(row.rejection_rate_pct).toFixed(1)}%`}</td>
              <td className="p-3 text-right"><span className="rounded-full bg-primary/10 px-2.5 py-1 font-bold text-primary">{Number(row.performance_score).toFixed(0)}</span></td>
            </tr>)}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">O ranking será formado após os primeiros recebimentos confirmados.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-semibold text-muted-foreground">{label}
    <Input className="mt-1" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

function Metric({ label, value, icon: Icon, loading, hot }: { label: string; value: string; icon: typeof TrendingUp; loading: boolean; hot?: boolean }) {
  return <div className={`min-h-32 rounded-2xl border p-4 shadow-sm ${hot ? "border-primary/35 bg-primary/[0.06]" : "border-border/70 bg-card"}`}>
    <span className={`grid size-9 place-items-center rounded-xl ${hot ? "bg-primary text-primary-foreground" : "bg-muted"}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
    {loading ? <div className="mt-3 h-7 w-20 animate-pulse rounded bg-muted" /> : <div className="mt-3 font-display text-2xl font-bold tabular-nums">{value}</div>}
    <div className="mt-1 text-xs font-semibold text-muted-foreground">{label}</div>
  </div>;
}

function ViewButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Boxes; label: string }) {
  return <button type="button" onClick={onClick} className={`flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
    <Icon className="h-4 w-4" aria-hidden="true" />{label}
  </button>;
}

function AbcBadge({ value }: { value: string }) {
  const style = value === "A" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : value === "B" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-slate-500/15 text-slate-700 dark:text-slate-300";
  return <span className={`rounded-full px-2 py-1 text-xs font-bold ${style}`}>{value}</span>;
}

function InventoryBadge({ value }: { value: string }) {
  const risky = ["sem_estoque", "risco_ruptura", "capital_parado"].includes(value);
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${risky ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
    {INVENTORY_LABELS[value] ?? value}
  </span>;
}

function PriceStatus({ value }: { value: string }) {
  const labels: Record<string, string> = { margem_negativa: "Margem negativa", abaixo_sugerido: "Abaixo do sugerido", acima_sugerido: "Acima do sugerido", sem_preco: "Sem preço", adequado: "Adequado" };
  return <span className={`mt-1 inline-block text-[10px] font-bold ${value === "margem_negativa" ? "text-destructive" : "text-muted-foreground"}`}>{labels[value] ?? value}</span>;
}
