import { useMemo, useState } from "react";
import { BarChart3, Calculator, ShieldCheck, SlidersHorizontal, TrendingDown, TrendingUp } from "lucide-react";

type Product = {
  id: string;
  name: string;
  sku: string;
  internal_code?: string | null;
  average_cost?: number | null;
  price_b2c?: number | null;
  price_b2b?: number | null;
  pricing?: {
    tax_rate?: number | null;
    commission_rate?: number | null;
    payment_fee_rate?: number | null;
    other_variable_rate?: number | null;
    fixed_cost_per_unit?: number | null;
    desired_margin_rate?: number | null;
  } | null;
};

const cash = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const pct = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n) + "%";
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const numerical = (n: string) => Number(n.replace(",", "."));
const rate = (n: unknown) => Number(n ?? 0) * 100;

const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-500/10";
const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

export function PricingSimulator({ products }: { products: Product[] }) {
  const [selectedId, setSelectedId] = useState("");
  const [channel, setChannel] = useState<"site" | "pdv" | "whatsapp" | "b2b">("site");
  const [units, setUnits] = useState("10");
  const [growth, setGrowth] = useState("20");
  const [discount, setDiscount] = useState("5");
  const [tax, setTax] = useState("0");
  const [fees, setFees] = useState("0");
  const [commission, setCommission] = useState("0");
  const [other, setOther] = useState("0");
  const [fixed, setFixed] = useState("0");
  const [freight, setFreight] = useState("0");
  const [floor, setFloor] = useState("0");
  const [query, setQuery] = useState("");

  const chosen = products.find((p) => p.id === selectedId) ?? null;
  const filtered = products.filter((p) => p.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")) || String(p.sku).toLowerCase().includes(query.toLowerCase()));
  const cost = Number(chosen?.average_cost ?? 0);
  const price = Number(channel === "b2b" ? chosen?.price_b2b : chosen?.price_b2c) || 0;

  const calculation = useMemo(() => {
    const count = numerical(units);
    const extra = numerical(growth);
    const rebate = numerical(discount);
    const rates = [tax, fees, commission, other].map(numerical);
    const fixedCost = numerical(fixed) + numerical(freight);
    const minimumMargin = numerical(floor);
    if (!chosen) return { error: "Selecione um produto para iniciar a simulação." } as const;
    if (!(cost > 0) || !(price > 0)) return { error: "Produto sem preço ou custo médio válido. Simulação bloqueada até corrigir o cadastro." } as const;
    if (![count, extra, rebate, fixedCost, minimumMargin, ...rates].every(Number.isFinite) ||
      count < 1 || !Number.isInteger(count) || count > 100000 ||
      extra < 0 || extra > 1000 || rebate < 0 || rebate >= 100 ||
      rates.some((r) => r < 0 || r > 100) || fixedCost < 0 || minimumMargin < 0 || minimumMargin > 100) {
      return { error: "Revise os campos: quantidades inteiras e percentuais válidos, sem valores negativos." } as const;
    }
    const share = rates.reduce((a, b) => a + b, 0) / 100;
    if (share >= 1) return { error: "A soma das despesas percentuais precisa ser inferior a 100%." } as const;
    const nextCount = Math.round(count * (1 + extra / 100));
    const nextPrice = round(price * (1 - rebate / 100));
    const unitContribution = (n: number) => n * (1 - share) - cost - fixedCost;
    const current = round(count * unitContribution(price));
    const projected = round(nextCount * unitContribution(nextPrice));
    const minPrice = (cost + fixedCost) / (1 - share);
    const desiredPrice = minimumMargin / 100 + share < 1
      ? (cost + fixedCost) / (1 - share - minimumMargin / 100) : null;
    const cap = (1 - ((current / nextCount + cost + fixedCost) / (price * (1 - share)))) * 100;
    const maxDiscount = Math.max(0, Math.min(100, cap));
    const safeDiscount = Math.max(0, (1 - minPrice / price) * 100);
    return {
      error: null,
      count, nextCount, nextPrice, current, projected,
      difference: round(projected - current),
      minPrice: round(minPrice),
      targetPrice: desiredPrice == null ? null : round(desiredPrice),
      maxDiscount: round(maxDiscount),
      breakEvenDiscount: round(safeDiscount),
      contributionUnit: round(unitContribution(nextPrice)),
      projectedSales: round(nextCount * nextPrice),
      negative: projected < 0,
      belowFloor: nextPrice < minPrice,
      insufficientGrowth: projected < current,
    } as const;
  }, [chosen, cost, price, units, growth, discount, tax, fees, commission, other, fixed, freight, floor]);

  function choose(id: string) {
    setSelectedId(id);
    const p = products.find((row) => row.id === id);
    setTax(String(rate(p?.pricing?.tax_rate)));
    setFees(String(rate(p?.pricing?.payment_fee_rate)));
    setCommission(String(rate(p?.pricing?.commission_rate)));
    setOther(String(rate(p?.pricing?.other_variable_rate)));
    setFixed(String(p?.pricing?.fixed_cost_per_unit ?? 0));
    setFreight("0");
    setFloor(String(rate(p?.pricing?.desired_margin_rate ?? 0)));
  }
  const metrics = calculation.error ? null : calculation;

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/70 shadow-sm" aria-label="Simulador de precificação e rentabilidade">
      <div className="border-b border-slate-200 bg-white px-5 py-6 lg:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Calculator className="h-5 w-5" /></div>
            <div><p className="text-xs font-bold uppercase tracking-[.16em] text-blue-700">Centro de decisões comerciais</p>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950 lg:text-2xl">Simulador de preço, volume e margem</h2>
              <p className="mt-1 text-sm text-slate-500">Compare cenários reais antes de conceder desconto. Nenhum preço do catálogo é alterado.</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800"><ShieldCheck className="h-4 w-4" /> Apenas simulação</span>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,.86fr)] lg:p-7">
        <div className="space-y-5">
          <div className={card}>
            <label htmlFor="pricing-product-search" className="text-xs font-bold uppercase tracking-wide text-slate-500">Encontrar produto</label>
            <input id="pricing-product-search" className={input + " mt-2"} placeholder="Digite nome ou SKU (até 50 itens carregados)" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label htmlFor="pricing-product" className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Produto</label>
            <select id="pricing-product" value={selectedId} onChange={(e) => choose(e.target.value)} className={input + " mt-2"}>
              <option value="">Selecione um produto</option>
              {filtered.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}
              {chosen && !filtered.some((p) => p.id === chosen.id) && <option value={chosen.id}>{chosen.name} · {chosen.sku}</option>}
            </select>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Custo médio</p><p className="mt-1 font-bold tabular-nums">{cost > 0 ? cash(cost) : "Sem custo"}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Preço vigente</p><p className="mt-1 font-bold tabular-nums">{price > 0 ? cash(price) : "Sem preço"}</p></div>
            </div>
          </div>

          <div className={card}>
            <div className="mb-4 flex items-center gap-2 text-slate-950"><SlidersHorizontal className="h-4 w-4 text-blue-700" /><h3 className="font-bold">Parâmetros da simulação</h3></div>
            <label className="text-xs font-bold uppercase text-slate-500" htmlFor="pricing-channel">Canal da venda</label>
            <select id="pricing-channel" className={input + " mt-2"} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="site">Site / e-commerce</option><option value="pdv">Balcão / PDV</option>
              <option value="whatsapp">WhatsApp</option><option value="b2b">B2B / revenda</option>
            </select>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {([
                ["Volume atual (un.)", units, setUnits], ["Crescimento esperado (%)", growth, setGrowth],
                ["Desconto simulado (%)", discount, setDiscount], ["Margem-alvo sobre receita (%)", floor, setFloor],
                ["Tributos (%)", tax, setTax], ["Taxa de pagamento (%)", fees, setFees],
                ["Comissão (%)", commission, setCommission], ["Outras despesas variáveis (%)", other, setOther],
                ["Custo fixo por unidade (R$)", fixed, setFixed], ["Frete subsidiado por unidade (R$)", freight, setFreight],
              ] as const).map(([label, value, setter]) => (
                <label key={label} className="min-w-0 text-xs font-semibold text-slate-600">
                  {label}
                  <input className={input + " mt-1.5 tabular-nums"} type="number" min="0" step={label.includes("Volume atual") ? "1" : "0.01"} value={value}
                    onChange={(e) => setter(e.target.value)} />
                </label>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-amber-700">
              Custos não configurados chegam como zero. Preencha as taxas efetivas do canal antes de usar o resultado na negociação.
              O crescimento de volume é uma hipótese, não uma previsão.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {calculation.error ? (
            <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-medium text-amber-900">{calculation.error}</div>
          ) : metrics && (
            <>
              <div className={card}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Contribuição total simulada</p>
                <p className={"mt-2 text-3xl font-bold tracking-tight tabular-nums " + (metrics.negative ? "text-rose-700" : "text-slate-950")}>{cash(metrics.projected)}</p>
                <div className={"mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold " + (metrics.difference >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800")}>
                  {metrics.difference >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {cash(metrics.difference)} em relação ao cenário atual
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-slate-500">Atual</p><p className="font-bold tabular-nums">{cash(metrics.current)}</p></div>
                  <div><p className="text-xs text-slate-500">Novo preço unitário</p><p className="font-bold tabular-nums">{cash(metrics.nextPrice)}</p></div>
                  <div><p className="text-xs text-slate-500">Volume estimado</p><p className="font-bold tabular-nums">{metrics.nextCount} unidades</p></div>
                  <div><p className="text-xs text-slate-500">Faturamento hipotético</p><p className="font-bold tabular-nums">{cash(metrics.projectedSales)}</p></div>
                </div>
              </div>

              <div className={card}>
                <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-blue-700" /><h3 className="font-bold text-slate-950">Comparação de cenários</h3></div>
                <div className="mt-5 space-y-4">
                  {([["Atual", metrics.current], ["Simulado", metrics.projected]] as const).map(([label, value]) => {
                    const max = Math.max(Math.abs(metrics.current),Math.abs(metrics.projected),1);
                    return <div key={label}>
                      <div className="mb-1.5 flex justify-between text-xs font-semibold text-slate-600"><span>{label}</span><span className="tabular-nums">{cash(value)}</span></div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className={"h-full rounded-full "+(value<0?"bg-rose-500":label==="Atual"?"bg-slate-500":"bg-blue-600")} style={{ width: Math.min(100,Math.abs(value)/max*100)+"%" }}/></div>
                    </div>;
                  })}
                </div>
              </div>

              <div className={card}>
                <h3 className="font-bold text-slate-950">Limites econômicos</h3>
                <div className="mt-4 space-y-3">
                  <div className="flex justify-between gap-3 text-sm"><span className="text-slate-600">Preço mínimo de contribuição zero</span><strong className="tabular-nums">{cash(metrics.minPrice)}</strong></div>
                  <div className="flex justify-between gap-3 text-sm"><span className="text-slate-600">Preço para margem-alvo</span><strong className="tabular-nums">{metrics.targetPrice==null?"Inviável":cash(metrics.targetPrice)}</strong></div>
                  <div className="flex justify-between gap-3 text-sm"><span className="text-slate-600">Desconto até contribuição unitária zero</span><strong>{pct(metrics.breakEvenDiscount)}</strong></div>
                  <div className="flex justify-between gap-3 border-t pt-3 text-sm"><span className="font-semibold">Desconto máximo para preservar contribuição total com este volume</span><strong className="text-xl tabular-nums text-blue-700">{pct(metrics.maxDiscount)}</strong></div>
                </div>
              </div>
              <div className={"rounded-2xl border p-4 text-sm font-semibold "+(metrics.belowFloor||metrics.insufficientGrowth?"border-amber-200 bg-amber-50 text-amber-900":"border-emerald-200 bg-emerald-50 text-emerald-900")}>
                {metrics.belowFloor ? "Atenção: o preço simulado fica abaixo do mínimo de contribuição." : metrics.insufficientGrowth ? "Atenção: o desconto reduz a contribuição total, mesmo com o aumento de volume." : "O cenário preserva a contribuição total estimada."}
              </div>
            </>
          )}
          <p className="px-1 text-xs leading-relaxed text-slate-500">
            Contribuição estimada = receita líquida de custos variáveis informados − CMV médio − despesas fixas unitárias informadas.
            Não equivale ao lucro líquido ou à DRE. Não incorpora tributos não parametrizados, perdas, devoluções nem variações futuras de custo.
            Simular não grava preços, reservas nem pedidos.
          </p>
        </div>
      </div>
    </section>
  );
}
