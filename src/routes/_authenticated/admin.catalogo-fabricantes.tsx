import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalLink, Pause, Play, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listManufacturerCatalog, saveManufacturerCodePattern, saveManufacturerSource, setManufacturerSourceStatus } from "@/lib/manufacturer-catalog.functions";

export const Route = createFileRoute("/_authenticated/admin/catalogo-fabricantes")({
  head: () => ({ meta: [{ title: "Catálogo inteligente de fabricantes · Admin" }] }),
  component: () => <SupplyGuard><Page /></SupplyGuard>,
});

function Page() {
  const qc = useQueryClient();
  const listFn = useServerFn(listManufacturerCatalog);
  const saveSourceFn = useServerFn(saveManufacturerSource);
  const statusFn = useServerFn(setManufacturerSourceStatus);
  const savePatternFn = useServerFn(saveManufacturerCodePattern);
  const [source, setSource] = useState({ brandId: "", name: "", sourceKind: "official_site", baseUrl: "", searchUrlTemplate: "", priority: "50" });
  const [pattern, setPattern] = useState({ brandId: "", name: "", codeRegex: "", normalizedPrefix: "", examples: "" });
  const { data, isLoading, error } = useQuery({ queryKey: ["manufacturer-catalog"], queryFn: () => listFn() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["manufacturer-catalog"] });
  const addSource = useMutation({
    mutationFn: () => saveSourceFn({ data: { ...source, sourceKind: source.sourceKind as any, priority: Number(source.priority) } }),
    onSuccess: () => {
      toast.success("Fonte oficial cadastrada");
      setSource({ brandId: "", name: "", sourceKind: "official_site", baseUrl: "", searchUrlTemplate: "", priority: "50" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({ mutationFn: (v: { sourceId: string; status: "active" | "paused" }) => statusFn({ data: v }), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const addPattern = useMutation({ mutationFn: () => savePatternFn({ data: { brandId: pattern.brandId, name: pattern.name, codeRegex: pattern.codeRegex, normalizedPrefix: pattern.normalizedPrefix || undefined, examples: pattern.examples.split(",") } }), onSuccess: () => { toast.success("Regra de código cadastrada"); setPattern({ brandId: "", name: "", codeRegex: "", normalizedPrefix: "", examples: "" }); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const sources = (data?.sources ?? []) as any[];
  const brands = (data?.brands ?? []) as any[];
  const patterns = (data?.patterns ?? []) as any[];

  return <div className="mx-auto max-w-7xl space-y-6">
    <header><h1 className="font-display text-2xl font-bold uppercase">Catálogo inteligente de fabricantes</h1><p className="mt-1 max-w-4xl text-sm text-muted-foreground">Este cadastro é a memória de fontes oficiais e regras que alimenta o robô automático de enriquecimento. Somente domínios ativos cadastrados aqui podem sustentar autoaprovação; não é um catálogo duplicado de produtos e não depende do Bling.</p></header>
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Fontes cadastradas" value={sources.length}/><Metric label="Fontes ativas" value={sources.filter(s=>s.status==="active").length}/><Metric label="Regras de código" value={patterns.filter(p=>p.active).length}/></div>
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm"><ShieldCheck className="mr-2 inline h-4 w-4"/><strong>Governança:</strong> domínio permitido, prioridade, origem e regra ficam auditáveis; imagens exigem autorização de uso.</div>

    <section className="rounded-lg border bg-card p-4"><h2 className="font-display text-lg font-bold uppercase">Fontes por fabricante</h2>
      <p className="mt-1 text-sm text-muted-foreground">A URL do catálogo pode ser fixa ou usar <code>{"{code}"}</code> / <code>{"{code_normalized}"}</code> quando o fabricante disponibilizar busca direta por referência.</p>
      {isLoading&&<p className="mt-3 text-sm text-muted-foreground">Carregando…</p>}{error&&<p role="alert" className="mt-3 text-sm text-destructive">{(error as Error).message}</p>}
      <div className="mt-3 space-y-2">{sources.map(s=><div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0 flex-1"><div className="font-semibold">{s.brand?.name} · {s.name}</div><div className="text-xs text-muted-foreground">{s.source_kind} · prioridade {s.priority} · {s.allowed_domains?.join(", ")}</div><div className="mt-1 truncate text-xs text-muted-foreground">Catálogo/busca: {s.search_url_template||s.base_url}</div>{s.last_error&&<div className="mt-1 text-xs text-destructive">Último erro: {s.last_error}</div>}</div><div className="flex gap-2"><a href={s.search_url_template?.includes("{")?s.base_url:(s.search_url_template||s.base_url)} target="_blank" rel="noreferrer" className="inline-flex items-center rounded border px-3 py-2 text-xs">Abrir <ExternalLink className="ml-1 h-3 w-3"/></a><Button size="sm" variant="outline" onClick={()=>toggle.mutate({sourceId:s.id,status:s.status==="active"?"paused":"active"})}>{s.status==="active"?<><Pause className="mr-1 h-3 w-3"/>Pausar</>:<><Play className="mr-1 h-3 w-3"/>Ativar</>}</Button></div></div>)}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-6">
        <BrandSelect value={source.brandId} brands={brands} onChange={v=>setSource({...source,brandId:v})}/>
        <Input placeholder="Nome da fonte" value={source.name} onChange={e=>setSource({...source,name:e.target.value})}/>
        <select className="h-10 rounded-md border bg-background px-3 text-sm" value={source.sourceKind} onChange={e=>setSource({...source,sourceKind:e.target.value})}><option value="official_site">Site oficial</option><option value="official_catalog">Catálogo oficial</option><option value="catalog_api">API oficial</option><option value="supplier_feed">Feed do fornecedor</option><option value="manual">Manual</option></select>
        <Input placeholder="https://fabricante.com.br" value={source.baseUrl} onChange={e=>setSource({...source,baseUrl:e.target.value})}/>
        <Input placeholder="URL catálogo/busca (opcional)" value={source.searchUrlTemplate} onChange={e=>setSource({...source,searchUrlTemplate:e.target.value})}/>
        <div className="flex gap-2"><Input className="w-20" type="number" min="1" max="100" title="Prioridade" value={source.priority} onChange={e=>setSource({...source,priority:e.target.value})}/><Button className="flex-1" disabled={!source.brandId||!source.name||!source.baseUrl||addSource.isPending} onClick={()=>addSource.mutate()}><Plus className="mr-1 h-4 w-4"/>Adicionar</Button></div>
      </div>
    </section>

    <section className="rounded-lg border bg-card p-4"><h2 className="font-display text-lg font-bold uppercase">Regras de código</h2><p className="text-sm text-muted-foreground">As regras detectam códigos suspeitos; não corrigem produtos automaticamente.</p>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">{patterns.map(p=><div key={p.id} className="rounded-md border p-3"><strong>{p.name}</strong><div className="mt-1 text-xs text-muted-foreground"><code>{p.code_regex}</code>{p.normalized_prefix&&` · prefixo ${p.normalized_prefix}`}</div><div className="mt-1 text-xs">Exemplos: {p.examples?.join(", ")||"—"}</div></div>)}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-5"><BrandSelect value={pattern.brandId} brands={brands} onChange={v=>setPattern({...pattern,brandId:v})}/><Input placeholder="Nome da regra" value={pattern.name} onChange={e=>setPattern({...pattern,name:e.target.value})}/><Input placeholder="Regex: ^SL-[A-Z0-9-]+$" value={pattern.codeRegex} onChange={e=>setPattern({...pattern,codeRegex:e.target.value})}/><Input placeholder="Exemplos separados por vírgula" value={pattern.examples} onChange={e=>setPattern({...pattern,examples:e.target.value})}/><Button disabled={!pattern.brandId||!pattern.name||!pattern.codeRegex||addPattern.isPending} onClick={()=>addPattern.mutate()}><Plus className="mr-1 h-4 w-4"/>Adicionar</Button></div>
    </section>
    <div className="flex justify-end"><Button asChild variant="outline"><Link to="/admin/enriquecimento-produtos">Abrir fila de enriquecimento</Link></Button></div>
  </div>;
}

function Metric({label,value}:{label:string;value:number}){return <div className="rounded-lg border bg-card p-4"><div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></div>}
function BrandSelect({value,brands,onChange}:{value:string;brands:any[];onChange:(v:string)=>void}){return <select className="h-10 rounded-md border bg-background px-3 text-sm" value={value} onChange={e=>onChange(e.target.value)}><option value="">Fabricante…</option>{brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}
