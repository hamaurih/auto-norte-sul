import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getSaneamentoStats,
  listProblemProducts,
  suggestBrands,
  suggestCategories,
  applyBrand,
  applyBrandBulk,
  applyCategory,
  applyCategoryBulk,
  initStockFromLegacy,
  listApplications,
  upsertApplication,
  deleteApplication,
} from "@/lib/saneamento.functions";
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
        <TabsContent value="imagem" className="mt-4"><TabSimpleList problem="sem_imagem" title="Produtos sem imagem" helpText="Reprocessamento via Bling: rode a importação Bling na aba Ecossistema › Bling. Aqui só listamos os pendentes para você priorizar." /></TabsContent>
        <TabsContent value="sku" className="mt-4"><TabSimpleList problem="sem_sku" title="Produtos sem SKU" helpText="SKU nunca é gerado automaticamente. Use o botão Editar para inserir manualmente." /></TabsContent>
        <TabsContent value="preco" className="mt-4"><TabSimpleList problem="sem_preco" title="Produtos com preço inválido (≤ 0)" helpText="Preço nunca é inventado. Ajuste manualmente ou reimporte do Bling." /></TabsContent>
        <TabsContent value="estoque" className="mt-4">
          <div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-card p-3">
            <div className="text-sm">
              Inicializar estoque multi-filial a partir do estoque legado (apenas para produtos ainda sem <code>product_stock</code>). Não soma, não sobrescreve.
            </div>
            <Button size="sm" onClick={() => initAll.mutate()} disabled={initAll.isPending}>
              {initAll.isPending ? "Inicializando..." : "Inicializar Matriz"}
            </Button>
          </div>
          <TabSimpleList problem="sem_multi" title="Produtos sem registro em multi-filial" helpText="Estes usam estoque legado como fallback." />
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
  const suggestFn = useServerFn(suggestCategories);
  const applyFn = useServerFn(applyCategory);
  const bulkFn = useServerFn(applyCategoryBulk);
  const [productMap, setProductMap] = useState<Record<string, string>>({});

  const sugg = useQuery({
    queryKey: ["san-cat-suggest"],
    queryFn: async () => {
      const list = await suggestFn({ data: { limit: 1000 } });
      const ids = list.map((s) => s.productId);
      if (ids.length) {
        const { data } = await supabase.from("products").select("id, name").in("id", ids);
        const map: Record<string, string> = {};
        (data ?? []).forEach((p) => (map[p.id] = p.name));
        setProductMap(map);
      }
      return list;
    },
  });

  const { data: cats } = useQuery({
    queryKey: ["all-cats"],
    queryFn: async () => (await supabase.from("categories").select("id, name, slug").order("name")).data ?? [],
  });

  const applyOne = useMutation({
    mutationFn: (v: { productId: string; categoryId: string }) => applyFn({ data: v }),
    onSuccess: () => { toast.success("Categoria aplicada"); qc.invalidateQueries({ queryKey: ["san-stats"] }); qc.invalidateQueries({ queryKey: ["san-cat-suggest"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const bulk = useMutation({
    mutationFn: (assignments: any[]) => bulkFn({ data: { assignments } }),
    onSuccess: (r) => { toast.success(`Aplicado em ${r.applied} produtos.`); qc.invalidateQueries({ queryKey: ["san-stats"] }); qc.invalidateQueries({ queryKey: ["san-cat-suggest"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const highs = (sugg.data ?? []).filter((s) => s.confidence === "alta");

  return (
    <div>
      <div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-card p-3">
        <div className="text-sm">{sugg.data?.length ?? 0} sugestões geradas por palavras-chave. Confiança <b>alta</b> = termo específico encontrado.</div>
        <Button size="sm" disabled={!highs.length || bulk.isPending} onClick={() => bulk.mutate(highs)}>
          {bulk.isPending ? "Aplicando..." : `Aplicar todas ALTAS (${highs.length})`}
        </Button>
      </div>
      {sugg.isLoading ? <p className="text-sm text-muted-foreground">Analisando…</p> : (
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted"><tr>
              <th className="p-2 text-left">Produto</th>
              <th className="p-2 text-left">Categoria sugerida</th>
              <th className="p-2 text-left">Confiança</th>
              <th className="p-2 text-left">Termo</th>
              <th className="p-2 text-right">Ação</th>
            </tr></thead>
            <tbody>
              {(sugg.data ?? []).map((s) => (
                <tr key={s.productId} className="border-t border-border">
                  <td className="p-2">{productMap[s.productId] ?? s.productId}</td>
                  <td className="p-2 font-bold">{s.categorySlug}</td>
                  <td className="p-2"><ConfBadge c={s.confidence} /></td>
                  <td className="p-2 text-xs text-muted-foreground">{s.matched}</td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => applyOne.mutate({ productId: s.productId, categoryId: s.categoryId })}>Aplicar</Button>
                      <select
                        className="rounded border border-border bg-background px-1 text-xs"
                        defaultValue=""
                        onChange={(e) => e.target.value && applyOne.mutate({ productId: s.productId, categoryId: e.target.value })}
                      >
                        <option value="">Outra...</option>
                        {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
              {(sugg.data ?? []).length === 0 && <tr><td colSpan={5} className="p-4 text-center text-sm text-muted-foreground">Nenhuma sugestão automática.</td></tr>}
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
