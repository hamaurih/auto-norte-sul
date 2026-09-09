import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeDollarSign,
  BarChart3,
  Calculator,
  CheckCircle2,
  CreditCard,
  Landmark,
  PackageSearch,
  Pencil,
  Plus,
  ReceiptText,
  Save,
  Search,
  Settings2,
  Target,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  deleteExpense,
  getProfitabilityCenter,
  saveExpense,
  saveProductProfitabilityRule,
  saveProfitabilityDefaults,
  saveSalesChannel,
  searchProfitabilityProducts,
  simulateProfitability,
} from "@/lib/profitability.functions";

export const Route = createFileRoute("/_authenticated/admin/rentabilidade")({
  head: () => ({ meta: [{ title: "Custos, Preços e Rentabilidade · Norte Sul" }] }),
  component: ProfitabilityPage,
});

type Tab = "resumo" | "simulador" | "canais" | "despesas";

const money = (value: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
const number = (value: unknown, digits = 2) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value ?? 0));
const today = () => new Date().toISOString().slice(0, 10);
const monthNow = () => new Date().toISOString().slice(0, 7);
const inputClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-50";
const buttonPrimary = "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
const buttonSoft = "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";

const blankChannel = () => ({
  id: "",
  name: "",
  code: "",
  active: true,
  isDefault: false,
  taxPct: "0",
  paymentFeePct: "0",
  salesCommissionPct: "0",
  marketplaceFeePct: "0",
  freightSubsidyPct: "0",
  anticipationPct: "0",
  expectedLossPct: "0",
  otherVariablePct: "0",
  fixedFeePerSale: "0",
});

const blankExpense = () => ({
  description: "",
  amount: "",
  kind: "fixed" as "fixed" | "variable",
  status: "planned" as "planned" | "paid" | "canceled",
  competenceDate: today(),
  dueDate: "",
  categoryId: "",
  costCenterId: "",
  supplierName: "",
  documentNumber: "",
  notes: "",
  recurring: false,
  recurrence: "monthly" as "weekly" | "monthly" | "quarterly" | "yearly",
});

function Card({ label, value, note, danger = false }: { label: string; value: React.ReactNode; note?: string; danger?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-4 shadow-sm ${danger ? "border-red-200" : "border-slate-200"}`}>
    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`mt-2 text-2xl font-extrabold ${danger ? "text-red-700" : "text-slate-950"}`}>{value}</p>
    {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
  </div>;
}

function PercentField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-sm font-semibold text-slate-700">{label}
    <div className="relative">
      <input className={`${inputClass} pr-9`} type="number" min="0" max="100" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="pointer-events-none absolute right-3 top-[22px] text-xs font-bold text-slate-400">%</span>
    </div>
  </label>;
}

function ProfitabilityPage() {
  const qc = useQueryClient();
  const loadCenter = useServerFn(getProfitabilityCenter);
  const searchProducts = useServerFn(searchProfitabilityProducts);
  const saveDefaults = useServerFn(saveProfitabilityDefaults);
  const saveChannel = useServerFn(saveSalesChannel);
  const saveExpenseFn = useServerFn(saveExpense);
  const deleteExpenseFn = useServerFn(deleteExpense);
  const simulate = useServerFn(simulateProfitability);
  const saveProductRule = useServerFn(saveProductProfitabilityRule);

  const [tab, setTab] = useState<Tab>("resumo");
  const [month, setMonth] = useState(monthNow());
  const center = useQuery({ queryKey: ["profitability-center", month], queryFn: () => loadCenter({ data: { month } }), staleTime: 30_000 });
  const data = center.data;

  const [targetDefault, setTargetDefault] = useState("20");
  const [minDefault, setMinDefault] = useState("10");
  const [defaultChannelId, setDefaultChannelId] = useState("");
  useEffect(() => {
    if (!data) return;
    setTargetDefault(String(data.settings.default_target_margin_pct ?? 20));
    setMinDefault(String(data.settings.default_min_margin_pct ?? 10));
    setDefaultChannelId(data.settings.default_sales_channel_id ?? "");
  }, [data]);

  const defaultsMutation = useMutation({
    mutationFn: () => saveDefaults({ data: { targetMarginPct: Number(targetDefault), minMarginPct: Number(minDefault), defaultChannelId: defaultChannelId || null } }),
    onSuccess: async () => { toast.success("Política de margem atualizada"); await qc.invalidateQueries({ queryKey: ["profitability-center"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar margens"),
  });

  const [channel, setChannel] = useState(blankChannel());
  const channelMutation = useMutation({
    mutationFn: () => saveChannel({ data: {
      id: channel.id || null,
      name: channel.name,
      code: channel.code || null,
      active: channel.active,
      isDefault: channel.isDefault,
      taxPct: Number(channel.taxPct || 0),
      paymentFeePct: Number(channel.paymentFeePct || 0),
      salesCommissionPct: Number(channel.salesCommissionPct || 0),
      marketplaceFeePct: Number(channel.marketplaceFeePct || 0),
      freightSubsidyPct: Number(channel.freightSubsidyPct || 0),
      anticipationPct: Number(channel.anticipationPct || 0),
      expectedLossPct: Number(channel.expectedLossPct || 0),
      otherVariablePct: Number(channel.otherVariablePct || 0),
      fixedFeePerSale: Number(channel.fixedFeePerSale || 0),
    } }),
    onSuccess: async () => { toast.success(channel.id ? "Canal atualizado" : "Canal criado"); setChannel(blankChannel()); await qc.invalidateQueries({ queryKey: ["profitability-center"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar canal"),
  });

  const [expense, setExpense] = useState(blankExpense());
  const expenseMutation = useMutation({
    mutationFn: () => saveExpenseFn({ data: {
      description: expense.description,
      amount: Number(expense.amount || 0),
      kind: expense.kind,
      status: expense.status,
      competenceDate: expense.competenceDate,
      dueDate: expense.dueDate || null,
      categoryId: expense.categoryId || null,
      costCenterId: expense.costCenterId || null,
      supplierName: expense.supplierName || null,
      documentNumber: expense.documentNumber || null,
      notes: expense.notes || null,
      recurring: expense.recurring,
      recurrence: expense.recurring ? expense.recurrence : null,
    } }),
    onSuccess: async () => { toast.success("Despesa lançada"); setExpense(blankExpense()); await qc.invalidateQueries({ queryKey: ["profitability-center"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao lançar despesa"),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteExpenseFn({ data: { id } }),
    onSuccess: async () => { toast.success("Despesa excluída"); await qc.invalidateQueries({ queryKey: ["profitability-center"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao excluir despesa"),
  });

  const [productSearch, setProductSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setDebouncedSearch(productSearch.trim()), 300); return () => window.clearTimeout(t); }, [productSearch]);
  const products = useQuery({ queryKey: ["profitability-products", debouncedSearch], queryFn: () => searchProducts({ data: { search: debouncedSearch, limit: 30 } }), staleTime: 30_000 });
  const [selectedProductId, setSelectedProductId] = useState("");
  const selectedProduct = useMemo(() => (products.data ?? []).find((p: any) => p.id === selectedProductId) ?? null, [products.data, selectedProductId]);

  const [costBasis, setCostBasis] = useState<"auto" | "average" | "last" | "replacement" | "manual">("auto");
  const [replacementCost, setReplacementCost] = useState("");
  const [manualCost, setManualCost] = useState("");
  const [inboundFreight, setInboundFreight] = useState("0");
  const [packagingCost, setPackagingCost] = useState("0");
  const [otherCost, setOtherCost] = useState("0");
  const [lossPct, setLossPct] = useState("0");
  const [productTarget, setProductTarget] = useState("");
  const [productMin, setProductMin] = useState("");
  const [productChannel, setProductChannel] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [simulation, setSimulation] = useState<any>(null);

  useEffect(() => {
    if (!selectedProduct) return;
    const r = selectedProduct.profitability_rule ?? {};
    setCostBasis(r.cost_basis ?? "auto");
    setReplacementCost(r.replacement_cost == null ? "" : String(r.replacement_cost));
    setManualCost(r.manual_cost == null ? "" : String(r.manual_cost));
    setInboundFreight(String(r.inbound_freight_value ?? 0));
    setPackagingCost(String(r.packaging_cost ?? 0));
    setOtherCost(String(r.other_unit_cost ?? 0));
    setLossPct(String(r.inventory_loss_pct ?? 0));
    setProductTarget(r.target_margin_pct == null ? "" : String(r.target_margin_pct));
    setProductMin(r.min_margin_pct == null ? "" : String(r.min_margin_pct));
    setProductChannel(r.preferred_channel_id ?? data?.settings.default_sales_channel_id ?? "");
    setSalePrice(String(selectedProduct.price_b2c ?? ""));
    setQuantity("1");
    setSimulation(null);
  }, [selectedProductId]);

  const simulationMutation = useMutation({
    mutationFn: () => simulate({ data: {
      productId: selectedProductId,
      channelId: productChannel || null,
      targetMarginPct: productTarget === "" ? null : Number(productTarget),
      salePrice: salePrice === "" ? null : Number(salePrice),
      quantity: Number(quantity || 1),
    } }),
    onSuccess: setSimulation,
    onError: (e: any) => toast.error(e?.message ?? "Erro ao simular"),
  });

  const productRulePayload = (applyRecommended: boolean) => ({
    productId: selectedProductId,
    costBasis,
    replacementCost: replacementCost === "" ? null : Number(replacementCost),
    manualCost: manualCost === "" ? null : Number(manualCost),
    inboundFreightValue: Number(inboundFreight || 0),
    packagingCost: Number(packagingCost || 0),
    otherUnitCost: Number(otherCost || 0),
    inventoryLossPct: Number(lossPct || 0),
    targetMarginPct: productTarget === "" ? null : Number(productTarget),
    minMarginPct: productMin === "" ? null : Number(productMin),
    preferredChannelId: productChannel || null,
    applyRecommended,
  });
  const ruleMutation = useMutation({
    mutationFn: (applyRecommended: boolean) => saveProductRule({ data: productRulePayload(applyRecommended) }),
    onSuccess: async (r: any) => {
      setSimulation(r?.simulation ?? null);
      toast.success(r?.applied ? "Regra salva e preço recomendado aplicado" : "Regra de rentabilidade salva");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["profitability-products"] }),
        qc.invalidateQueries({ queryKey: ["profitability-center"] }),
        qc.invalidateQueries({ queryKey: ["admin-products-fast"] }),
      ]);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar regra"),
  });

  if (center.isLoading || !data) return <div className="p-8 text-sm text-slate-500">Carregando custos e rentabilidade...</div>;
  const dashboard: any = data.dashboard ?? {};
  const channels: any[] = data.channels ?? [];
  const categories: any[] = data.categories ?? [];
  const centers: any[] = data.centers ?? [];
  const expenses: any[] = data.expenses ?? [];

  const tabs: Array<[Tab, string, React.ReactNode]> = [
    ["resumo", "Visão gerencial", <BarChart3 className="h-4 w-4" />],
    ["simulador", "Preço e margem", <Calculator className="h-4 w-4" />],
    ["canais", "Custos por canal", <CreditCard className="h-4 w-4" />],
    ["despesas", "Despesas", <ReceiptText className="h-4 w-4" />],
  ];

  return <div className="mx-auto max-w-[1550px] space-y-6 pb-16">
    <header className="rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-sm lg:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10"><TrendingUp className="h-6 w-6" /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">Gestão de resultado</p><h1 className="mt-1 text-3xl font-extrabold">Custos, Preços e Rentabilidade</h1><p className="mt-2 max-w-3xl text-sm text-slate-300">Forma preço pela margem desejada, inclui custos variáveis do canal, acompanha despesas e mostra a margem de contribuição real.</p></div></div>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-300">Competência<input className="mt-2 h-10 rounded-xl border border-white/15 bg-white/10 px-3 text-sm text-white outline-none" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
      </div>
    </header>

    <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      {tabs.map(([key, label, icon]) => <button key={key} onClick={() => setTab(key)} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${tab === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{icon}{label}</button>)}
    </nav>

    {tab === "resumo" ? <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Card label="Faturamento" value={money(dashboard.revenue)} note={`${dashboard.orders ?? 0} pedidos no mês`} />
        <Card label="CMV" value={money(dashboard.cmv)} note="Custo das mercadorias" />
        <Card label="Margem contribuição" value={money(dashboard.contribution)} note={`${number(dashboard.contribution_margin_pct)}% do faturamento`} danger={Number(dashboard.contribution) < 0} />
        <Card label="Despesas fixas" value={money(dashboard.fixed_expenses)} note="Competência do mês" />
        <Card label="Resultado operacional" value={money(dashboard.operating_result)} note="Contribuição - fixas" danger={Number(dashboard.operating_result) < 0} />
        <Card label="Ponto de equilíbrio" value={dashboard.break_even_revenue == null ? "—" : money(dashboard.break_even_revenue)} note="Faturamento necessário" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3"><Target className="h-5 w-5 text-emerald-600" /><div><h2 className="font-bold text-slate-950">Política padrão de margem</h2><p className="text-sm text-slate-500">Usada quando o produto não possui uma regra própria.</p></div></div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <PercentField label="Margem desejada" value={targetDefault} onChange={setTargetDefault} />
            <PercentField label="Margem mínima" value={minDefault} onChange={setMinDefault} />
            <label className="text-sm font-semibold text-slate-700">Canal padrão<select className={inputClass} value={defaultChannelId} onChange={(e) => setDefaultChannelId(e.target.value)}><option value="">Sem canal</option>{channels.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          </div>
          <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900"><strong>Margem não é markup.</strong> O preço recomendado é calculado como custo efetivo ÷ (1 - custos variáveis - margem desejada), incorporando também a taxa fixa do canal.</div>
          <button className={`${buttonPrimary} mt-5`} disabled={defaultsMutation.isPending} onClick={() => defaultsMutation.mutate()}><Save className="h-4 w-4" />Salvar política</button>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3"><Landmark className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold text-slate-950">Leitura do mês</h2><p className="text-sm text-slate-500">Custos que reduzem o resultado.</p></div></div>
          <div className="mt-5 space-y-3 text-sm">
            {[
              ["Custos variáveis dos canais", dashboard.channel_variable_costs],
              ["Taxas fixas dos canais", dashboard.channel_fixed_fees],
              ["Outras despesas variáveis", dashboard.variable_expenses],
              ["Despesas fixas", dashboard.fixed_expenses],
            ].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="text-slate-600">{label}</span><strong>{money(value)}</strong></div>)}
          </div>
          <div className={`mt-4 rounded-2xl border p-4 text-sm ${Number(dashboard.snapshot_coverage_pct ?? 100) < 100 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
            {Number(dashboard.snapshot_coverage_pct ?? 100) < 100 ? <><AlertTriangle className="mr-2 inline h-4 w-4" />Cobertura histórica de custo: {number(dashboard.snapshot_coverage_pct)}%. Vendas antigas sem fotografia de custo usam o custo atual como estimativa.</> : <><CheckCircle2 className="mr-2 inline h-4 w-4" />Cobertura de custos registrada: {number(dashboard.snapshot_coverage_pct)}%.</>}
          </div>
        </div>
      </section>
    </> : null}

    {tab === "simulador" ? <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3"><PackageSearch className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold">Escolha o produto</h2><p className="text-sm text-slate-500">Busque por nome, SKU ou código.</p></div></div>
        <div className="relative mt-4"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input className={`${inputClass} mt-0 pl-9`} value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Ex.: lâmpada, 12345..." /></div>
        <div className="mt-4 max-h-[620px] space-y-2 overflow-y-auto pr-1">{(products.data ?? []).map((p: any) => <button key={p.id} onClick={() => setSelectedProductId(p.id)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedProductId === p.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}><p className="truncate text-sm font-bold text-slate-900">{p.name}</p><p className="mt-1 text-xs text-slate-500">{p.internal_code || p.sku || "Sem código"} · venda {money(p.price_b2c)}</p><p className="mt-1 text-xs text-slate-400">Custo médio {money(p.average_cost)} · último {money(p.last_purchase_cost)}</p></button>)}</div>
      </div>

      <div className="space-y-6">
        {!selectedProduct ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center"><Calculator className="mx-auto h-10 w-10 text-slate-300" /><h2 className="mt-4 font-bold text-slate-900">Selecione um produto</h2><p className="mt-1 text-sm text-slate-500">O sistema mostrará custo efetivo, preço mínimo, preço recomendado e margem real.</p></div> : <>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Produto selecionado</p><h2 className="mt-1 text-xl font-extrabold text-slate-950">{selectedProduct.name}</h2><p className="text-sm text-slate-500">Venda atual {money(selectedProduct.price_b2c)} · médio {money(selectedProduct.average_cost)} · último custo {money(selectedProduct.last_purchase_cost)}</p></div></div>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-sm font-semibold text-slate-700">Base de custo<select className={inputClass} value={costBasis} onChange={(e) => setCostBasis(e.target.value as any)}><option value="auto">Automático (médio → último)</option><option value="average">Custo médio</option><option value="last">Último custo</option><option value="replacement">Custo de reposição</option><option value="manual">Custo manual</option></select></label>
              {costBasis === "replacement" ? <label className="text-sm font-semibold text-slate-700">Custo reposição<input className={inputClass} type="number" min="0" step="0.01" value={replacementCost} onChange={(e) => setReplacementCost(e.target.value)} /></label> : null}
              {costBasis === "manual" ? <label className="text-sm font-semibold text-slate-700">Custo manual<input className={inputClass} type="number" min="0" step="0.01" value={manualCost} onChange={(e) => setManualCost(e.target.value)} /></label> : null}
              <label className="text-sm font-semibold text-slate-700">Frete de entrada / un.<input className={inputClass} type="number" min="0" step="0.01" value={inboundFreight} onChange={(e) => setInboundFreight(e.target.value)} /></label>
              <label className="text-sm font-semibold text-slate-700">Embalagem / un.<input className={inputClass} type="number" min="0" step="0.01" value={packagingCost} onChange={(e) => setPackagingCost(e.target.value)} /></label>
              <label className="text-sm font-semibold text-slate-700">Outros custos / un.<input className={inputClass} type="number" min="0" step="0.01" value={otherCost} onChange={(e) => setOtherCost(e.target.value)} /></label>
              <PercentField label="Perdas / quebras" value={lossPct} onChange={setLossPct} />
              <label className="text-sm font-semibold text-slate-700">Canal de venda<select className={inputClass} value={productChannel} onChange={(e) => { setProductChannel(e.target.value); setSimulation(null); }}><option value="">Canal padrão</option>{channels.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="text-sm font-semibold text-slate-700">Margem desejada (%)<input className={inputClass} type="number" min="0" max="94.99" step="0.01" placeholder={`Padrão ${targetDefault}%`} value={productTarget} onChange={(e) => { setProductTarget(e.target.value); setSimulation(null); }} /></label>
              <label className="text-sm font-semibold text-slate-700">Margem mínima (%)<input className={inputClass} type="number" min="-100" max="94.99" step="0.01" placeholder={`Padrão ${minDefault}%`} value={productMin} onChange={(e) => setProductMin(e.target.value)} /></label>
              <label className="text-sm font-semibold text-slate-700">Preço para testar<input className={inputClass} type="number" min="0" step="0.01" value={salePrice} onChange={(e) => { setSalePrice(e.target.value); setSimulation(null); }} /></label>
              <label className="text-sm font-semibold text-slate-700">Quantidade da venda<input className={inputClass} type="number" min="1" step="1" value={quantity} onChange={(e) => { setQuantity(e.target.value); setSimulation(null); }} /></label>
            </div>
            <div className="mt-6 flex flex-wrap gap-3"><button className={buttonPrimary} disabled={simulationMutation.isPending} onClick={() => simulationMutation.mutate()}><Calculator className="h-4 w-4" />Calcular margem real</button><button className={buttonSoft} disabled={ruleMutation.isPending} onClick={() => ruleMutation.mutate(false)}><Save className="h-4 w-4" />Salvar regra</button></div>
          </div>

          {simulation ? <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3"><BadgeDollarSign className="h-5 w-5 text-emerald-600" /><div><h2 className="font-bold text-slate-950">Resultado da formação</h2><p className="text-sm text-slate-500">Canal {simulation.channel_name} · custos variáveis {number(simulation.variable_cost_pct)}%</p></div></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Card label="Custo efetivo" value={money(simulation.effective_cost)} note="Produto + adicionais + perdas" />
              <Card label="Preço mínimo" value={money(simulation.minimum_price)} note={`Mantém ${number(simulation.min_margin_pct)}%`} />
              <Card label="Preço recomendado" value={money(simulation.recommended_price)} note={`Alvo ${number(simulation.target_margin_pct)}%`} />
              <Card label="Margem no preço testado" value={`${number(simulation.contribution_margin_pct)}%`} note={money(simulation.contribution_amount) + " por unidade"} danger={Boolean(simulation.below_minimum)} />
              <Card label="Markup equivalente" value={`${number(simulation.markup_pct)}%`} note="Mostrado só para comparação" />
            </div>
            {simulation.below_minimum ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800"><AlertTriangle className="mr-2 inline h-4 w-4" />O preço testado está abaixo do mínimo operacional configurado.</div> : <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4" />O preço testado está acima da margem mínima.</div>}
            <button className={`${buttonPrimary} mt-5 bg-emerald-700 hover:bg-emerald-800`} disabled={ruleMutation.isPending} onClick={() => { if (window.confirm(`Aplicar ${money(simulation.recommended_price)} como preço B2C deste produto?`)) ruleMutation.mutate(true); }}><TrendingUp className="h-4 w-4" />Aplicar preço recomendado</button>
          </div> : null}
        </>}
      </div>
    </section> : null}

    {tab === "canais" ? <section className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3"><Settings2 className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold">{channel.id ? "Editar canal" : "Novo canal de venda"}</h2><p className="text-sm text-slate-500">Impostos, cartão, comissão, marketplace, frete e outras taxas.</p></div></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Nome<input className={inputClass} value={channel.name} onChange={(e) => setChannel((c) => ({ ...c, name: e.target.value }))} placeholder="Ex.: Cartão 6x" /></label><label className="text-sm font-semibold text-slate-700">Código<input className={inputClass} value={channel.code} onChange={(e) => setChannel((c) => ({ ...c, code: e.target.value }))} placeholder="Automático se vazio" /></label>
          <PercentField label="Impostos" value={channel.taxPct} onChange={(v) => setChannel((c) => ({ ...c, taxPct: v }))} />
          <PercentField label="Taxa pagamento/cartão" value={channel.paymentFeePct} onChange={(v) => setChannel((c) => ({ ...c, paymentFeePct: v }))} />
          <PercentField label="Comissão vendedor" value={channel.salesCommissionPct} onChange={(v) => setChannel((c) => ({ ...c, salesCommissionPct: v }))} />
          <PercentField label="Comissão marketplace" value={channel.marketplaceFeePct} onChange={(v) => setChannel((c) => ({ ...c, marketplaceFeePct: v }))} />
          <PercentField label="Frete subsidiado" value={channel.freightSubsidyPct} onChange={(v) => setChannel((c) => ({ ...c, freightSubsidyPct: v }))} />
          <PercentField label="Antecipação" value={channel.anticipationPct} onChange={(v) => setChannel((c) => ({ ...c, anticipationPct: v }))} />
          <PercentField label="Perdas/inadimplência" value={channel.expectedLossPct} onChange={(v) => setChannel((c) => ({ ...c, expectedLossPct: v }))} />
          <PercentField label="Outros variáveis" value={channel.otherVariablePct} onChange={(v) => setChannel((c) => ({ ...c, otherVariablePct: v }))} />
          <label className="text-sm font-semibold text-slate-700">Taxa fixa por venda<input className={inputClass} type="number" min="0" step="0.01" value={channel.fixedFeePerSale} onChange={(e) => setChannel((c) => ({ ...c, fixedFeePerSale: e.target.value }))} /></label>
        </div>
        <div className="mt-5 flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={channel.active} onChange={(e) => setChannel((c) => ({ ...c, active: e.target.checked }))} />Ativo</label><label className="flex items-center gap-2"><input type="checkbox" checked={channel.isDefault} onChange={(e) => setChannel((c) => ({ ...c, isDefault: e.target.checked }))} />Canal padrão</label></div>
        <div className="mt-5 flex gap-3"><button className={buttonPrimary} disabled={channelMutation.isPending} onClick={() => channelMutation.mutate()}><Save className="h-4 w-4" />Salvar canal</button>{channel.id ? <button className={buttonSoft} onClick={() => setChannel(blankChannel())}>Cancelar</button> : null}</div>
      </div>

      <div className="space-y-3">{channels.map((c) => {
        const variable = [c.tax_pct,c.payment_fee_pct,c.sales_commission_pct,c.marketplace_fee_pct,c.freight_subsidy_pct,c.anticipation_pct,c.expected_loss_pct,c.other_variable_pct].reduce((s, v) => s + Number(v ?? 0), 0);
        return <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h3 className="font-bold text-slate-950">{c.name}</h3>{c.is_default ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">PADRÃO</span> : null}{!c.active ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">INATIVO</span> : null}</div><p className="mt-1 text-sm text-slate-500">Variáveis: <strong>{number(variable)}%</strong> · taxa fixa: <strong>{money(c.fixed_fee_per_sale)}</strong></p></div><button className={buttonSoft} onClick={() => setChannel({ id: c.id, name: c.name, code: c.code, active: c.active, isDefault: c.is_default, taxPct: String(c.tax_pct ?? 0), paymentFeePct: String(c.payment_fee_pct ?? 0), salesCommissionPct: String(c.sales_commission_pct ?? 0), marketplaceFeePct: String(c.marketplace_fee_pct ?? 0), freightSubsidyPct: String(c.freight_subsidy_pct ?? 0), anticipationPct: String(c.anticipation_pct ?? 0), expectedLossPct: String(c.expected_loss_pct ?? 0), otherVariablePct: String(c.other_variable_pct ?? 0), fixedFeePerSale: String(c.fixed_fee_per_sale ?? 0) })}><Pencil className="h-4 w-4" />Editar</button></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4"><span>Impostos {number(c.tax_pct)}%</span><span>Pagamento {number(c.payment_fee_pct)}%</span><span>Vendedor {number(c.sales_commission_pct)}%</span><span>Marketplace {number(c.marketplace_fee_pct)}%</span><span>Frete {number(c.freight_subsidy_pct)}%</span><span>Antecipação {number(c.anticipation_pct)}%</span><span>Perdas {number(c.expected_loss_pct)}%</span><span>Outros {number(c.other_variable_pct)}%</span></div></div>;
      })}</div>
    </section> : null}

    {tab === "despesas" ? <section className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3"><WalletCards className="h-5 w-5 text-violet-600" /><div><h2 className="font-bold">Lançar despesa</h2><p className="text-sm text-slate-500">A competência alimenta automaticamente a rentabilidade e o ponto de equilíbrio.</p></div></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2 text-sm font-semibold text-slate-700">Descrição<input className={inputClass} value={expense.description} onChange={(e) => setExpense((x) => ({ ...x, description: e.target.value }))} placeholder="Ex.: aluguel da loja" /></label><label className="text-sm font-semibold text-slate-700">Valor<input className={inputClass} type="number" min="0" step="0.01" value={expense.amount} onChange={(e) => setExpense((x) => ({ ...x, amount: e.target.value }))} /></label><label className="text-sm font-semibold text-slate-700">Tipo<select className={inputClass} value={expense.kind} onChange={(e) => setExpense((x) => ({ ...x, kind: e.target.value as any }))}><option value="fixed">Fixa</option><option value="variable">Variável</option></select></label><label className="text-sm font-semibold text-slate-700">Categoria<select className={inputClass} value={expense.categoryId} onChange={(e) => { const id=e.target.value; const cat=categories.find((c)=>c.id===id); setExpense((x)=>({ ...x, categoryId:id, kind: cat?.default_kind ?? x.kind })); }}><option value="">Sem categoria</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Centro de custo<select className={inputClass} value={expense.costCenterId} onChange={(e) => setExpense((x) => ({ ...x, costCenterId: e.target.value }))}><option value="">Sem centro</option>{centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Competência<input className={inputClass} type="date" value={expense.competenceDate} onChange={(e) => setExpense((x) => ({ ...x, competenceDate: e.target.value }))} /></label><label className="text-sm font-semibold text-slate-700">Vencimento<input className={inputClass} type="date" value={expense.dueDate} onChange={(e) => setExpense((x) => ({ ...x, dueDate: e.target.value }))} /></label><label className="text-sm font-semibold text-slate-700">Status<select className={inputClass} value={expense.status} onChange={(e) => setExpense((x) => ({ ...x, status: e.target.value as any }))}><option value="planned">Prevista</option><option value="paid">Paga</option><option value="canceled">Cancelada</option></select></label><label className="text-sm font-semibold text-slate-700">Fornecedor<input className={inputClass} value={expense.supplierName} onChange={(e) => setExpense((x) => ({ ...x, supplierName: e.target.value }))} /></label><label className="text-sm font-semibold text-slate-700">Documento<input className={inputClass} value={expense.documentNumber} onChange={(e) => setExpense((x) => ({ ...x, documentNumber: e.target.value }))} /></label><label className="sm:col-span-2 text-sm font-semibold text-slate-700">Observações<textarea className="mt-2 min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-blue-500" value={expense.notes} onChange={(e) => setExpense((x) => ({ ...x, notes: e.target.value }))} /></label></div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={expense.recurring} onChange={(e) => setExpense((x) => ({ ...x, recurring: e.target.checked }))} />Recorrente</label>{expense.recurring ? <select className="h-9 rounded-lg border border-slate-200 px-2" value={expense.recurrence} onChange={(e) => setExpense((x) => ({ ...x, recurrence: e.target.value as any }))}><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></select> : null}</div>
        <button className={`${buttonPrimary} mt-5`} disabled={expenseMutation.isPending} onClick={() => expenseMutation.mutate()}><Plus className="h-4 w-4" />Lançar despesa</button>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Últimos lançamentos</h2><p className="text-sm text-slate-500">Até 100 despesas mais recentes por competência.</p></div><ReceiptText className="h-5 w-5 text-slate-400" /></div><div className="mt-4 space-y-2">{expenses.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Nenhuma despesa lançada.</p> : expenses.map((e) => { const cat=categories.find((c)=>c.id===e.category_id); const centerItem=centers.find((c)=>c.id===e.cost_center_id); return <div key={e.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-950">{e.description}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${e.kind === "fixed" ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-700"}`}>{e.kind === "fixed" ? "FIXA" : "VARIÁVEL"}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{e.status === "paid" ? "PAGA" : e.status === "canceled" ? "CANCELADA" : "PREVISTA"}</span></div><p className="mt-1 text-xs text-slate-500">{e.competence_date} · {cat?.name ?? "Sem categoria"} · {centerItem?.name ?? "Sem centro"}</p></div><div className="flex items-center gap-3"><strong className="text-lg text-slate-950">{money(e.amount)}</strong><button aria-label="Excluir despesa" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => { if (window.confirm(`Excluir a despesa “${e.description}”?`)) deleteMutation.mutate(e.id); }}><Trash2 className="h-4 w-4" /></button></div></div>; })}</div></div>
    </section> : null}
  </div>;
}
