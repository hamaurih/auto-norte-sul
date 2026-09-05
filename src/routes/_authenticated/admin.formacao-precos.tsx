import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BadgeDollarSign, Calculator, History, Percent, Search, Settings2 } from "lucide-react";
import { applyPricingAdjustment, getPricingCenter, previewPricingAdjustment, saveGlobalPricing, saveProductPricingRule, searchPricingProducts } from "@/lib/pricing.functions";

export const Route = createFileRoute("/_authenticated/admin/formacao-precos")({
  head: () => ({ meta: [{ title: "Formação de Preços · Norte Sul" }] }),
  component: PricingCenterPage,
});

const money = (value: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
const inputClass = "h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

function ProductRuleRow({ product, globalMarkup, onSaved }: { product: any; globalMarkup: number; onSaved: () => void }) {
  const saveRule = useServerFn(saveProductPricingRule);
  const [mode, setMode] = useState<"global" | "markup" | "manual">(product.rule?.mode ?? "global");
  const [value, setValue] = useState(String(mode === "markup" ? product.rule?.markup_pct ?? globalMarkup : mode === "manual" ? product.rule?.manual_b2c_price ?? product.price_b2c : ""));
  useEffect(() => {
    const nextMode = product.rule?.mode ?? "global";
    setMode(nextMode);
    setValue(String(nextMode === "markup" ? product.rule?.markup_pct ?? globalMarkup : nextMode === "manual" ? product.rule?.manual_b2c_price ?? product.price_b2c : ""));
  }, [product.id, product.rule?.mode, product.rule?.markup_pct, product.rule?.manual_b2c_price, product.price_b2c, globalMarkup]);

  const mutation = useMutation({
    mutationFn: () => saveRule({ data: { productId: product.id, mode, markupPct: mode === "markup" ? Number(value) : null, manualPrice: mode === "manual" ? Number(value) : null } }),
    onSuccess: () => { toast.success("Regra individual atualizada"); onSaved(); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar regra"),
  });
  const projected = mode === "global" ? Number(product.price_b2b ?? 0) * (1 + globalMarkup / 100) : mode === "markup" ? Number(product.price_b2b ?? 0) * (1 + Number(value || 0) / 100) : Number(value || 0);

  return <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[minmax(0,1fr)_130px_160px_130px_110px] lg:items-center">
    <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{product.name}</p><p className="mt-1 text-xs text-slate-500">{product.internal_code || product.sku} · B2B {money(product.price_b2b)} · B2C atual {money(product.price_b2c)}</p></div>
    <select className={inputClass} value={mode} onChange={(e) => { const m = e.target.value as any; setMode(m); setValue(m === "markup" ? String(globalMarkup) : m === "manual" ? String(product.price_b2c ?? 0) : ""); }}><option value="global">Margem global</option><option value="markup">Margem própria</option><option value="manual">Preço manual</option></select>
    {mode === "global" ? <div className="text-sm text-slate-500">Global: {globalMarkup.toFixed(2)}%</div> : <div className="relative"><input className={`${inputClass} w-full pr-9`} type="number" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)} /><span className="absolute right-3 top-3 text-xs text-slate-400">{mode === "markup" ? "%" : "R$"}</span></div>}
    <div className="text-sm"><span className="text-slate-500">Novo B2C</span><p className="font-bold text-slate-950">{money(projected)}</p></div>
    <button disabled={mutation.isPending} onClick={() => mutation.mutate()} className="h-11 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50">Salvar</button>
  </div>;
}

function PricingCenterPage() {
  const qc = useQueryClient();
  const loadCenter = useServerFn(getPricingCenter);
  const searchProducts = useServerFn(searchPricingProducts);
  const saveGlobal = useServerFn(saveGlobalPricing);
  const previewAdjustment = useServerFn(previewPricingAdjustment);
  const applyAdjustment = useServerFn(applyPricingAdjustment);
  const center = useQuery({ queryKey: ["pricing-center"], queryFn: () => loadCenter(), staleTime: 60_000 });
  const [globalMarkup, setGlobalMarkup] = useState("0");
  const [rounding, setRounding] = useState<"cent" | "x90" | "x99" | "whole">("cent");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [target, setTarget] = useState<"b2b" | "b2c">("b2b");
  const [percentage, setPercentage] = useState("0");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [preview, setPreview] = useState<any>(null);

  useEffect(() => { if (center.data) { setGlobalMarkup(String(center.data.settings.default_b2c_markup_pct ?? 0)); setRounding(center.data.settings.price_rounding as any); } }, [center.data]);
  useEffect(() => { const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => window.clearTimeout(t); }, [search]);

  const products = useQuery({ queryKey: ["pricing-products", debouncedSearch], queryFn: () => searchProducts({ data: { search: debouncedSearch, limit: 25 } }), staleTime: 30_000 });
  const globalMutation = useMutation({ mutationFn: () => saveGlobal({ data: { markupPct: Number(globalMarkup), rounding, recalculate: true } }), onSuccess: async (r: any) => { toast.success(`Margem global aplicada. ${r?.recalculated ?? 0} produtos recalculados.`); await Promise.all([qc.invalidateQueries({ queryKey: ["pricing-center"] }), qc.invalidateQueries({ queryKey: ["pricing-products"] }), qc.invalidateQueries({ queryKey: ["admin-products-fast"] })]); }, onError: (e: any) => toast.error(e?.message ?? "Erro ao aplicar margem") });
  const previewMutation = useMutation({ mutationFn: () => previewAdjustment({ data: { target, percentage: Number(percentage), brandId: brandId || null, categoryId: categoryId || null, onlyActive } }), onSuccess: setPreview, onError: (e: any) => toast.error(e?.message ?? "Erro ao simular") });
  const applyMutation = useMutation({ mutationFn: () => applyAdjustment({ data: { requestId: crypto.randomUUID(), target, percentage: Number(percentage), brandId: brandId || null, categoryId: categoryId || null, onlyActive } }), onSuccess: async (r: any) => { toast.success(`Reajuste aplicado em ${r?.affected ?? 0} produtos.`); setPreview(null); await Promise.all([qc.invalidateQueries({ queryKey: ["pricing-center"] }), qc.invalidateQueries({ queryKey: ["pricing-products"] }), qc.invalidateQueries({ queryKey: ["admin-products-fast"] })]); }, onError: (e: any) => toast.error(e?.message ?? "Erro ao aplicar reajuste") });

  const data = center.data;
  if (center.isLoading || !data) return <div className="p-8 text-sm text-slate-500">Carregando formação de preços...</div>;
  const categories = (data.categories ?? []).filter((c: any) => !c.parent_id);

  return <div className="mx-auto max-w-[1500px] space-y-6 pb-16">
    <header className="rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-sm lg:p-8"><div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><BadgeDollarSign className="h-6 w-6" /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-200">Gestão comercial</p><h1 className="mt-1 text-3xl font-extrabold">Formação e reajuste de preços</h1><p className="mt-1 text-sm text-slate-300">B2B é o preço base. B2C é formado pela margem global ou por exceção individual.</p></div></div></header>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[
      ["Produtos", data.summary.total], ["Ativos", data.summary.active], ["Com preço B2B", data.summary.withB2b], ["B2B médio", money(data.summary.avgB2b)], ["Exceções individuais", data.summary.exceptions],
    ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-2xl font-extrabold text-slate-950">{value}</p></div>)}</section>

    <section className="grid gap-6 xl:grid-cols-2">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><Settings2 className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold text-slate-950">Formação B2B → B2C</h2><p className="text-sm text-slate-500">A margem global é aplicada a todos que não possuem exceção individual.</p></div></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Margem global B2C<div className="relative mt-2"><input className={`${inputClass} w-full pr-9`} type="number" min="0" step="0.01" value={globalMarkup} onChange={(e) => setGlobalMarkup(e.target.value)} /><span className="absolute right-3 top-3 text-slate-400">%</span></div></label><label className="text-sm font-semibold text-slate-700">Arredondamento<select className={`${inputClass} mt-2 w-full`} value={rounding} onChange={(e) => setRounding(e.target.value as any)}><option value="cent">Centavos normais</option><option value="x90">Terminar em ,90</option><option value="x99">Terminar em ,99</option><option value="whole">Valor inteiro</option></select></label></div><div className="mt-5 rounded-2xl bg-blue-50 p-4 text-sm text-blue-900">Exemplo: B2B {money(100)} + {Number(globalMarkup || 0).toFixed(2)}% = B2C {money(100 * (1 + Number(globalMarkup || 0) / 100))}. O preço B2B original é preservado.</div><button disabled={globalMutation.isPending} onClick={() => { if (window.confirm(`Aplicar margem global de ${Number(globalMarkup || 0).toFixed(2)}% e recalcular o B2C dos produtos sem preço manual?`)) globalMutation.mutate(); }} className="mt-5 h-11 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">Aplicar margem global</button></div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><Calculator className="h-5 w-5 text-violet-600" /><div><h2 className="font-bold text-slate-950">Reajuste em massa</h2><p className="text-sm text-slate-500">Sempre simule antes. Ao reajustar B2B, o B2C acompanha automaticamente.</p></div></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><select className={inputClass} value={target} onChange={(e) => { setTarget(e.target.value as any); setPreview(null); }}><option value="b2b">Reajustar B2B + recalcular B2C</option><option value="b2c">Reajustar somente B2C (fixa manual)</option></select><div className="relative"><input className={`${inputClass} w-full pr-9`} type="number" step="0.01" value={percentage} onChange={(e) => { setPercentage(e.target.value); setPreview(null); }} /><span className="absolute right-3 top-3 text-slate-400">%</span></div><select className={inputClass} value={brandId} onChange={(e) => { setBrandId(e.target.value); setPreview(null); }}><option value="">Todas as marcas</option>{(data.brands ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select><select className={inputClass} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPreview(null); }}><option value="">Todas as categorias</option>{categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div><label className="mt-4 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={onlyActive} onChange={(e) => { setOnlyActive(e.target.checked); setPreview(null); }} /> Somente produtos ativos</label><button disabled={previewMutation.isPending} onClick={() => previewMutation.mutate()} className="mt-5 h-11 rounded-xl border border-violet-200 bg-violet-50 px-5 text-sm font-bold text-violet-700 hover:bg-violet-100">Simular reajuste</button>{preview ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-amber-700">Produtos afetados</p><p className="text-xl font-bold">{preview.affected}</p></div><div><p className="text-xs text-amber-700">Média atual</p><p className="text-xl font-bold">{money(preview.average_before)}</p></div><div><p className="text-xs text-amber-700">Nova média</p><p className="text-xl font-bold">{money(preview.average_after)}</p></div></div><button disabled={applyMutation.isPending || !preview.affected} onClick={() => { if (window.confirm(`Confirmar reajuste de ${Number(percentage).toFixed(2)}% em ${preview.affected} produtos?`)) applyMutation.mutate(); }} className="mt-4 h-11 rounded-xl bg-amber-600 px-5 text-sm font-bold text-white disabled:opacity-50">Aplicar reajuste</button></div> : null}</div>
    </section>

    <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-6"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2"><Percent className="h-5 w-5 text-emerald-600" /><h2 className="font-bold text-slate-950">Exceções por produto</h2></div><p className="mt-1 text-sm text-slate-500">Use a margem global, uma margem própria ou fixe um preço B2C manual para um produto específico.</p></div><div className="relative w-full md:max-w-md"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input className={`${inputClass} w-full pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome, SKU ou código" /></div></div><div className="mt-5 space-y-3">{products.isLoading ? <p className="text-sm text-slate-500">Carregando produtos...</p> : (products.data ?? []).map((product: any) => <ProductRuleRow key={product.id} product={product} globalMarkup={Number(data.settings.default_b2c_markup_pct ?? 0)} onSaved={() => { qc.invalidateQueries({ queryKey: ["pricing-products"] }); qc.invalidateQueries({ queryKey: ["pricing-center"] }); qc.invalidateQueries({ queryKey: ["admin-products-fast"] }); }} />)}</div></section>

    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><History className="h-5 w-5 text-slate-600" /><h2 className="font-bold text-slate-950">Últimos reajustes</h2></div><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-400"><tr><th className="py-2">Data</th><th>Alvo</th><th>Percentual</th><th>Produtos</th><th>Média antes</th><th>Média depois</th></tr></thead><tbody>{(data.history ?? []).map((h: any) => <tr key={h.id} className="border-t border-slate-100"><td className="py-3">{new Date(h.created_at).toLocaleString("pt-BR")}</td><td>{h.target === "b2b" ? "B2B" : "B2C"}</td><td>{Number(h.adjustment_pct).toFixed(2)}%</td><td>{h.affected_count}</td><td>{money(h.average_before)}</td><td>{money(h.average_after)}</td></tr>)}</tbody></table></div></section>
  </div>;
}
