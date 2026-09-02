import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getSaneamentoStats,
  listProblemProducts,
  suggestBrands,
  applyBrand,
  applyBrandBulk,
  initStockFromLegacy,
  listApplications,
  upsertApplication,
  deleteApplication,
} from "@/lib/saneamento.functions";
import {
  suggestProductTaxonomy,
  applyProductTaxonomy,
  applyProductTaxonomyBulk,
  type ProductTaxonomySuggestion,
} from "@/lib/catalog-taxonomy.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/saneamento")({
  head: () => ({ meta: [{ title: "Saneamento do Catálogo · Admin" }] }),
  component: SaneamentoPage,
});

type Problem = "sem_marca" | "sem_categoria" | "sem_sku" | "sem_preco" | "sem_estoque" | "sem_imagem" | "sem_aplicacao" | "sem_multi";

function Stat({ label, value, warn, total }: { label: string; value: number; warn?: boolean; total?: number }) {
  const pct = total && total > 0 ? Math.round(((total - value) / total) * 100) : null;
  return (
    <div className={`rounded-lg border p-3 ${warn ? "border-hot bg-hot/5" : "border-border bg-card"}`}>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value.toLocaleString("pt-BR")}</div>
      {pct !== null && <div className="mt-0.5 text-[10px] text-muted-foreground">{pct}% ok</div>}
    </div>
  );
}

function SaneamentoPage() {
  const statsFn = useServerFn(getSaneamentoStats);
  const stats = useQuery({ queryKey: ["san-stats"], queryFn: () => statsFn() });
  const initLegacyFn = useServerFn(initStockFromLegacy);
  const qc = useQueryClient();

  const initAll = useMutation({
    mutationFn: () => initLegacyFn({ data: { all: true } }),
    onSuccess: (r) => { toast.success(`Estoque inicializado: ${r.created} produtos`); qc.invalidateQueries({ queryKey: ["san-stats"] }); qc.invalidateQueries({ queryKey: ["san-list"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold uppercase">Saneamento do Catálogo</h1>
      </div>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Total" value={stats.data?.total ?? 0} />
        <Stat label="Sem marca" value={stats.data?.semMarca ?? 0} warn={(stats.data?.semMarca ?? 0) > 0} total={stats.data?.total} />
        <Stat label="Sem categoria" value={stats.data?.semCategoria ?? 0} warn={(stats.data?.semCategoria ?? 0) > 0} total={stats.data?.total} />
        <Stat label="Sem imagem" value={stats.data?.semImagem ?? 0} warn={(stats.data?.semImagem ?? 0) > 0} total={stats.data?.total} />
        <Stat label="Link expirado" value={stats.data?.imagemExpirada ?? 0} warn={(stats.data?.imagemExpirada ?? 0) > 0} total={stats.data?.total} />
        <Stat label="Imagem válida" value={stats.data?.imagensValidas ?? 0} total={stats.data?.total} />
        <Stat label="Sem SKU" value={stats.data?.semSku ?? 0} warn={(stats.data?.semSku ?? 0) > 0} total={stats.data?.total} />
        <Stat label="Sem preço" value={stats.data?.semPreco ?? 0} warn={(stats.data?.semPreco ?? 0) > 0} total={stats.data?.total} />
        <Stat label="Sem estoque" value={stats.data?.semEstoque ?? 0} warn={(stats.data?.semEstoque ?? 0) > 0} total={stats.data?.total} />
        <Stat label="Sem aplicação" value={stats.data?.semAplicacao ?? 0} total={stats.data?.total} />
        <Stat label="Sem multi-filial" value={stats.data?.semMultiEstoque ?? 0} total={stats.data?.total} />
      </section>

      <Tabs defaultValue="marca">
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="marca">Marcas</TabsTrigger>
          <TabsTrigger value="categoria">Categorias</TabsTrigger>
          <TabsTrigger value="imagem">Imagens</TabsTrigger>
          <TabsTrigger value="sku">SKU / Código</TabsTrigger>
          <TabsTrigger value="preco">Preço</TabsTrigger>
          <TabsTrigger value="estoque">Estoque</TabsTrigger>
          <TabsTrigger value="aplicacao">Aplicações</TabsTrigger>
        </TabsList>

        <TabsContent value="marca" className="mt-4"><TabBrand /></TabsContent>
        <TabsContent value="categoria" className="mt-4"><TabCategory /></TabsContent>
        <TabsContent value="imagem" className="mt-4"><TabSimpleList problem="sem_imagem" title="Produtos sem imagem válida" actionLabel="Corrigir imagem" helpText="A lista mostra pendências de imagem (incluindo links temporários expirados). Use o botão à direita para abrir o cadastro do produto e corrigir." /></TabsContent>
        <TabsContent value="sku" className="mt-4"><TabSimpleList problem="sem_sku" title="Produtos sem SKU" actionLabel="Editar SKU" helpText="A lista mostra pendências de SKU. Use o botão à direita para abrir o cadastro do produto e inserir o SKU manualmente — ele nunca é gerado automaticamente." /></TabsContent>
        <TabsContent value="preco" className="mt-4"><TabSimpleList problem="sem_preco" title="Produtos com preço inválido (≤ 0)" actionLabel="Corrigir preço" helpText="A lista mostra pendências de preço. Use o botão à direita para abrir o cadastro do produto e ajustar o preço — ele nunca é inventado." /></TabsContent>
        <TabsContent value="estoque" className="mt-4">
          <div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-card p-3">
            <div className="text-sm">
              Inicializar estoque multi-filial a partir do estoque legado (apenas para produtos ainda sem <code>product_stock</code>). Não soma, não sobrescreve.
            </div>
            <Button size="sm" onClick={() => initAll.mutate()} disabled={initAll.isPending}>
              {initAll.isPending ? "Inicializando..." : "Inicializar Matriz"}
            </Button>
          </div>
          <TabSimpleList problem="sem_multi" title="Produtos sem registro em multi-filial" actionLabel="Abrir produto" helpText="A lista mostra pendências de estoque multi-filial. Use o botão à direita para abrir o cadastro do produto e configurar." />
        </TabsContent>
        <TabsContent value="aplicacao" className="mt-4"><TabApplications /></TabsContent>
      </Tabs>
    </div>
  );
}

// =========== TAB: SIMPLE LIST ===========
function TabSimpleList({ problem, title, helpText }: { problem: Problem; title: string; helpText?: string }) {
  const [search, setSearch] = useState("");
  const fn = useServerFn(listProblemProducts);
  const q = useQuery({
    queryKey: ["san-list", problem, search],
    queryFn: () => fn({ data: { problem, search: search || undefined, limit: 200 } }),
  });
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <Input placeholder="Buscar por nome ou SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>
      {helpText && <p className="mb-2 text-xs text-muted-foreground">{helpText}</p>}
      {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted"><tr>
              <th className="p-2 text-left">Produto</th>
              <th className="p-2 text-left">SKU</th>
              <th className="p-2 text-right">Preço</th>
              <th className="p-2 text-right">Estoque</th>
            </tr></thead>
            <tbody>
              {(q.data?.rows ?? []).map((p: any) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="p-2">{p.name}</td>
                  <td className="p-2 font-mono text-xs">{p.sku ?? "—"}</td>
                  <td className="p-2 text-right">R$ {Number(p.price_b2c ?? 0).toFixed(2)}</td>
                  <td className="p-2 text-right">{p.stock ?? 0}</td>
                </tr>
              ))}
              {(q.data?.rows ?? []).length === 0 && <tr><td colSpan={4} className="p-4 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =========== TAB: BRAND ===========
function ConfBadge({ c }: { c: string }) {
  const cls = c === "alta" ? "bg-green-500/15 text-green-600 border-green-500/30" : c === "media" ? "bg-yellow-500/15 text-yellow-700 border-yellow-500/30" : "bg-red-500/15 text-red-600 border-red-500/30";
  return <Badge variant="outline" className={cls}>{c}</Badge>;
}

function TabBrand() {
  const qc = useQueryClient();
  const suggestFn = useServerFn(suggestBrands);
  const applyFn = useServerFn(applyBrand);
  const bulkFn = useServerFn(applyBrandBulk);

  const [productMap, setProductMap] = useState<Record<string, { name: string; sku: string | null }>>({});
  const sugg = useQuery({
    queryKey: ["san-brand-suggest"],
    queryFn: async () => {
      const list = await suggestFn({ data: { scanAll: true, limit: 1000 } });
      const ids = list.map((s) => s.productId);
      if (ids.length) {
        const { data } = await supabase.from("products").select("id, name, sku").in("id", ids);
        const map: Record<string, { name: string; sku: string | null }> = {};
        (data ?? []).forEach((p) => (map[p.id] = { name: p.name, sku: p.sku }));
        setProductMap(map);
      }
      return list;
    },
  });

  const { data: brands } = useQuery({
    queryKey: ["all-brands"],
    queryFn: async () => (await supabase.from("brands").select("id, name").order("name")).data ?? [],
  });

  const applyOne = useMutation({
    mutationFn: (v: { productId: string; brandId: string }) => applyFn({ data: v }),
    onSuccess: () => { toast.success("Marca aplicada"); qc.invalidateQueries({ queryKey: ["san-stats"] }); qc.invalidateQueries({ queryKey: ["san-brand-suggest"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const bulk = useMutation({
    mutationFn: (assignments: any[]) => bulkFn({ data: { assignments } }),
    onSuccess: (r) => { toast.success(`Aplicado em ${r.applied} produtos (${r.skipped} ignorados por baixa confiança).`); qc.invalidateQueries({ queryKey: ["san-stats"] }); qc.invalidateQueries({ queryKey: ["san-brand-suggest"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const buckets = useMemo(() => {
    const g: Record<string, any[]> = { alta: [], media: [], baixa: [] };
    (sugg.data ?? []).forEach((s) => g[s.confidence].push(s));
    return g;
  }, [sugg.data]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <div className="text-sm">
          Sugestões: <b>{buckets.alta.length}</b> alta · <b>{buckets.media.length}</b> média · <b>{buckets.baixa.length}</b> baixa
        </div>
        <Button size="sm" disabled={!buckets.alta.length || bulk.isPending} onClick={() => bulk.mutate(buckets.alta)}>
          {bulk.isPending ? "Aplicando..." : `Aplicar todas ALTAS (${buckets.alta.length})`}
        </Button>
      </div>
      {sugg.isLoading ? <p className="text-sm text-muted-foreground">Analisando produtos…</p> : (
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted"><tr>
              <th className="p-2 text-left">Produto</th>
              <th className="p-2 text-left">Marca sugerida</th>
              <th className="p-2 text-left">Confiança</th>
              <th className="p-2 text-left">Match</th>
              <th className="p-2 text-right">Ação</th>
            </tr></thead>
            <tbody>
              {(sugg.data ?? []).map((s) => (
                <tr key={s.productId} className="border-t border-border">
                  <td className="p-2">{productMap[s.productId]?.name ?? s.productId}</td>
                  <td className="p-2 font-bold">{s.brandName}</td>
                  <td className="p-2"><ConfBadge c={s.confidence} /></td>
                  <td className="p-2 text-xs text-muted-foreground">{s.matchedIn}</td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" disabled={applyOne.isPending} onClick={() => applyOne.mutate({ productId: s.productId, brandId: s.brandId })}>Aplicar</Button>
                      <select
                        className="rounded border border-border bg-background px-1 text-xs"
                        defaultValue=""
                        onChange={(e) => e.target.value && applyOne.mutate({ productId: s.productId, brandId: e.target.value })}
                      >
                        <option value="">Outra marca...</option>
                        {(brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
              {(sugg.data ?? []).length === 0 && <tr><td colSpan={5} className="p-4 text-center text-sm text-muted-foreground">Nenhuma sugestão automática. Produtos sem marca podem não conter o nome da marca no título/descrição.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =========== TAB: CATEGORY ===========
function TabCategory() {
  const qc = useQueryClient();
  const suggestFn = useServerFn(suggestProductTaxonomy);
  const applyFn = useServerFn(applyProductTaxonomy);
  const bulkFn = useServerFn(applyProductTaxonomyBulk);
  const [search, setSearch] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [termSearch, setTermSearch] = useState("");

  const sugg = useQuery({
    queryKey: ["san-cat-suggest"],
    queryFn: () => suggestFn({ data: { limit: 3000, includeAssigned: true } }),
  });

  const { data: cats } = useQuery({
    queryKey: ["all-cats"],
    queryFn: async () => (await supabase.from("categories").select("id, name, slug, parent_id").eq("active", true).order("name")).data ?? [],
  });

  const applyOne = useMutation({
    mutationFn: (v: { productId: string; categoryId: string; subcategoryId: string; ruleId?: string | null; confidence?: "alta" | "media" | "baixa" }) => applyFn({ data: v }),
    onSuccess: () => { toast.success("Categoria e subcategoria aplicadas"); qc.invalidateQueries({ queryKey: ["san-stats"] }); qc.invalidateQueries({ queryKey: ["san-cat-suggest"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const bulk = useMutation({
    mutationFn: (assignments: any[]) => bulkFn({ data: { assignments } }),
    onSuccess: (r) => { toast.success(`Aplicado em ${r.applied} produtos.`); qc.invalidateQueries({ queryKey: ["san-stats"] }); qc.invalidateQueries({ queryKey: ["san-cat-suggest"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const suggestions: ProductTaxonomySuggestion[] = sugg.data ?? [];
  const termStats = useMemo(() => {
    const counts = new Map<string, number>();
    suggestions.forEach((s) => {
      const term = String(s.matched ?? "").trim();
      if (term) counts.set(term, (counts.get(term) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, "pt-BR"));
  }, [suggestions]);

  const categoryOptions = useMemo(() => {
    const values = new Set<string>();
    suggestions.forEach((s) => values.add(s.categorySlug));
    return Array.from(values).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [suggestions]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    return suggestions.filter((s) => {
      const productName = s.productName.toLocaleLowerCase("pt-BR");
      if (needle && !productName.includes(needle)) return false;
      if (confidenceFilter !== "all" && s.confidence !== confidenceFilter) return false;
      if (categoryFilter !== "all" && s.categorySlug !== categoryFilter) return false;
      if (selectedTerms.length > 0 && !selectedTerms.includes(s.matched)) return false;
      return true;
    });
  }, [suggestions, search, confidenceFilter, categoryFilter, selectedTerms]);

  const parentCategories = (cats ?? []).filter((category) => !category.parent_id);
  const categoryPairs = parentCategories.flatMap((category) =>
    (cats ?? [])
      .filter((subcategory) => subcategory.parent_id === category.id)
      .map((subcategory) => ({ category, subcategory })),
  );

  const filteredHighs = filtered.filter((s) => s.confidence === "alta");
  const hasFilters = Boolean(search || confidenceFilter !== "all" || categoryFilter !== "all" || selectedTerms.length);
  const visibleTerms = termStats.filter(({ term }) => term.toLocaleLowerCase("pt-BR").includes(termSearch.trim().toLocaleLowerCase("pt-BR")));

  const toggleTerm = (term: string) => {
    setSelectedTerms((current) => current.includes(term) ? current.filter((item) => item !== term) : [...current, term]);
  };
  const clearFilters = () => {
    setSearch("");
    setConfidenceFilter("all");
    setCategoryFilter("all");
    setSelectedTerms([]);
    setTermSearch("");
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="text-sm">
          <b>{filtered.length}</b> de {suggestions.length} sugestões exibidas. Confiança <b>alta</b> = tipo do produto reconhecido no início do nome.
        </div>
        <Button size="sm" disabled={!filteredHighs.length || bulk.isPending} onClick={() => bulk.mutate(filteredHighs)}>
          {bulk.isPending ? "Aplicando..." : `Aplicar ALTAS filtradas (${filteredHighs.length})`}
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
        <Input
          placeholder="Buscar produto..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[220px] max-w-sm"
        />

        <details className="relative">
          <summary className="list-none cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted">
            Termo: {selectedTerms.length ? `${selectedTerms.length} selecionado(s)` : "Todos"} ▾
          </summary>
          <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-border bg-card p-3 shadow-xl">
            <Input
              placeholder="Buscar termo..."
              value={termSearch}
              onChange={(e) => setTermSearch(e.target.value)}
              className="mb-2 h-9"
            />
            <button
              type="button"
              onClick={() => setSelectedTerms([])}
              className={`mb-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${selectedTerms.length === 0 ? "bg-primary/10 font-bold text-primary" : "hover:bg-muted"}`}
            >
              <span>Todos os termos</span><span>{suggestions.length}</span>
            </button>
            <div className="max-h-64 space-y-0.5 overflow-auto pr-1">
              {visibleTerms.map(({ term, count }) => (
                <label key={term} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selectedTerms.includes(term)}
                    onChange={() => toggleTerm(term)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span className="min-w-0 flex-1 truncate">{term}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{count}</span>
                </label>
              ))}
              {visibleTerms.length === 0 && <div className="p-2 text-center text-xs text-muted-foreground">Nenhum termo encontrado.</div>}
            </div>
          </div>
        </details>

        <select
          aria-label="Filtrar por confiança"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          value={confidenceFilter}
          onChange={(e) => setConfidenceFilter(e.target.value)}
        >
          <option value="all">Confiança: todas</option>
          <option value="alta">Alta</option>
          <option value="media">Média</option>
          <option value="baixa">Baixa</option>
        </select>

        <select
          aria-label="Filtrar por categoria sugerida"
          className="h-10 max-w-[260px] rounded-md border border-border bg-background px-3 text-sm"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">Categoria: todas</option>
          {categoryOptions.map((slug) => <option key={slug} value={slug}>{slug}</option>)}
        </select>

        {hasFilters && <Button size="sm" variant="ghost" onClick={clearFilters}>Limpar filtros</Button>}
      </div>

      {selectedTerms.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-muted-foreground">Termos ativos:</span>
          {selectedTerms.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => toggleTerm(term)}
              className="rounded-full border border-border bg-background px-2 py-1 text-xs hover:border-primary hover:text-primary"
              title="Remover este termo do filtro"
            >
              {term} ×
            </button>
          ))}
        </div>
      )}

      {sugg.isLoading ? <p className="text-sm text-muted-foreground">Analisando…</p> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted"><tr>
              <th className="p-2 text-left">Produto</th>
              <th className="p-2 text-left">Categoria e subcategoria sugeridas</th>
              <th className="p-2 text-left">Confiança</th>
              <th className="p-2 text-left">
                <div className="flex items-center gap-1.5">Termo{selectedTerms.length > 0 && <Badge variant="outline">{selectedTerms.length}</Badge>}</div>
              </th>
              <th className="p-2 text-right">Ação</th>
            </tr></thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.productId} className="border-t border-border">
                  <td className="p-2">{s.productName}</td>
                  <td className="p-2 font-bold">
                    {s.categoryName}<span className="mx-1 text-muted-foreground">›</span>{s.subcategoryName}
                  </td>
                  <td className="p-2"><ConfBadge c={s.confidence} /></td>
                  <td className="p-2 text-xs text-muted-foreground">{s.matched}</td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" disabled={applyOne.isPending} onClick={() => applyOne.mutate({
                        productId: s.productId,
                        categoryId: s.categoryId,
                        subcategoryId: s.subcategoryId,
                        ruleId: s.ruleId,
                        confidence: s.confidence,
                      })}>Aplicar</Button>
                      <select
                        className="rounded border border-border bg-background px-1 text-xs"
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const [categoryId, subcategoryId] = e.target.value.split("|");
                          applyOne.mutate({ productId: s.productId, categoryId, subcategoryId, ruleId: null, confidence: "alta" });
                        }}
                      >
                        <option value="">Outra categoria...</option>
                        {categoryPairs.map(({ category, subcategory }) => (
                          <option key={subcategory.id} value={`${category.id}|${subcategory.id}`}>
                            {category.name} › {subcategory.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">Nenhuma sugestão corresponde aos filtros atuais.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =========== TAB: APPLICATIONS ===========
function TabApplications() {
  const [productId, setProductId] = useState<string>("");
  const [make, setMake] = useState(""); const [model, setModel] = useState("");
  const [yFrom, setYFrom] = useState<string>(""); const [yTo, setYTo] = useState<string>("");
  const listFn = useServerFn(listApplications);
  const upsertFn = useServerFn(upsertApplication);
  const delFn = useServerFn(deleteApplication);
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: ["apps", productId], queryFn: () => productId ? listFn({ data: { productId } }) : Promise.resolve([]), enabled: !!productId });
  const missingFn = useServerFn(listProblemProducts);
  const missing = useQuery({ queryKey: ["san-list", "sem_aplicacao"], queryFn: () => missingFn({ data: { problem: "sem_aplicacao", limit: 200 } }) });

  const add = useMutation({
    mutationFn: () => upsertFn({ data: { product_id: productId, vehicle_make: make, vehicle_model: model, year_from: yFrom ? Number(yFrom) : null, year_to: yTo ? Number(yTo) : null } }),
    onSuccess: () => { toast.success("Aplicação adicionada"); setMake(""); setModel(""); setYFrom(""); setYTo(""); qc.invalidateQueries({ queryKey: ["apps"] }); qc.invalidateQueries({ queryKey: ["san-stats"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const rm = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apps"] }),
  });

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="rounded-lg border border-border bg-card p-2">
        <div className="mb-2 text-xs font-bold uppercase">Produtos sem aplicação</div>
        <div className="max-h-[400px] space-y-1 overflow-auto text-sm">
          {(missing.data?.rows ?? []).map((p: any) => (
            <button
              key={p.id}
              onClick={() => setProductId(p.id)}
              className={`block w-full rounded px-2 py-1 text-left hover:bg-muted ${productId === p.id ? "bg-muted font-bold" : ""}`}
            >
              {p.name}
            </button>
          ))}
          {(missing.data?.rows ?? []).length === 0 && <p className="text-xs text-muted-foreground">—</p>}
        </div>
      </div>
      <div>
        {!productId ? <p className="text-sm text-muted-foreground">Selecione um produto na lista à esquerda.</p> : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              <Input placeholder="Marca (ex: Chevrolet)" value={make} onChange={(e) => setMake(e.target.value)} />
              <Input placeholder="Modelo (ex: Onix)" value={model} onChange={(e) => setModel(e.target.value)} />
              <Input placeholder="Ano de" type="number" value={yFrom} onChange={(e) => setYFrom(e.target.value)} />
              <Input placeholder="Ano até" type="number" value={yTo} onChange={(e) => setYTo(e.target.value)} />
              <Button onClick={() => add.mutate()} disabled={!make || !model || add.isPending}>Adicionar</Button>
            </div>
            <div className="rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>
                  <th className="p-2 text-left">Marca</th>
                  <th className="p-2 text-left">Modelo</th>
                  <th className="p-2 text-left">Ano</th>
                  <th className="p-2 text-right"></th>
                </tr></thead>
                <tbody>
                  {(listQ.data ?? []).map((a: any) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="p-2">{a.vehicle_make}</td>
                      <td className="p-2">{a.vehicle_model}</td>
                      <td className="p-2">{a.year_from ?? "?"}—{a.year_to ?? "?"}</td>
                      <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => rm.mutate(a.id)}>Remover</Button></td>
                    </tr>
                  ))}
                  {(listQ.data ?? []).length === 0 && <tr><td colSpan={4} className="p-4 text-center text-xs text-muted-foreground">Nenhuma aplicação ainda.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
