import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, FileSearch, Search, ShieldCheck, Tags } from "lucide-react";
import { toast } from "sonner";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFiscalProductQueue, saveFiscalProfilesBatch, type FiscalProfileInput } from "@/lib/fiscal.functions";
import { qty } from "@/lib/supplies-ui";

export const Route=createFileRoute("/_authenticated/admin/fiscal-produtos")({
  head:()=>({meta:[{title:"Saneamento tributário · Admin"},{name:"description",content:"Classificação e aprovação fiscal dos produtos."}]}),
  component:()=> <SupplyGuard><FiscalProductsPage/></SupplyGuard>,
});

const initialForm:Omit<FiscalProfileInput,"productIds">={ncm:"",cest:"",origin:0,cfopInState:"",cfopOutState:"",icmsCst:"",icmsCsosn:"",icmsRate:0,pisCst:"",pisRate:0,cofinsCst:"",cofinsRate:0,notes:""};

function FiscalProductsPage(){
  const qc=useQueryClient();const queueFn=useServerFn(getFiscalProductQueue);const saveFn=useServerFn(saveFiscalProfilesBatch);
  const [typedSearch,setTypedSearch]=useState("");const [search,setSearch]=useState("");const [selected,setSelected]=useState<string[]>([]);const [form,setForm]=useState(initialForm);
  const query=useQuery({queryKey:["fiscal-product-queue",search],queryFn:()=>queueFn({data:{search}})});const data=query.data as any;const items=(data?.items??[]) as any[];
  const save=useMutation({mutationFn:()=>saveFn({data:{...form,productIds:selected}}),onSuccess:r=>{toast.success(`${r.updated} produto(s) classificados`);setSelected([]);qc.invalidateQueries({queryKey:["fiscal-product-queue"]});qc.invalidateQueries({queryKey:["fiscal-overview"]});},onError:(e:Error)=>toast.error(e.message)});
  const toggle=(id:string)=>setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);const allSelected=items.length>0&&items.every(i=>selected.includes(i.id));
  const field=(key:keyof typeof form,label:string,type="text")=><label className="text-xs font-bold uppercase text-muted-foreground">{label}<Input className="mt-1" type={type} value={String(form[key]??"")} onChange={e=>setForm({...form,[key]:type==="number"?Number(e.target.value):e.target.value})}/></label>;
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="rounded-3xl border bg-gradient-to-br from-violet-500/15 via-card to-cyan-500/10 p-6">
      <Link to="/admin/fiscal" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4"/>Central Fiscal</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4"><div><div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-bold text-violet-700"><Tags className="h-4 w-4"/> SANEAMENTO TRIBUTÁRIO</div><h1 className="mt-3 font-display text-3xl font-bold">Produtos prontos para emissão fiscal</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Classifique NCM e regras de saída com aprovação humana. Dados de XML são tratados apenas como sugestão.</p></div></div>
    </header>
    <section className="grid gap-3 md:grid-cols-3">
      <Metric label="Produtos ativos" value={qty(data?.totalProducts??0)} detail="Base total"/>
      <Metric label="Perfis aprovados" value={qty(data?.approvedCount??0)} detail="Prontos para validação fiscal" good/>
      <Metric label="Pendentes" value={qty(data?.missingCount??0)} detail="Bloqueiam a emissão" warning/>
    </section>
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm"><strong>Controle de risco:</strong> NCM encontrado em XML de compra não define sozinho a tributação da venda. CFOP, CSOSN/CST e alíquotas devem ser confirmados com a contabilidade.</div>
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap gap-2"><Input value={typedSearch} onChange={e=>setTypedSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&setSearch(typedSearch)} placeholder="Buscar por nome, SKU, código do fabricante ou GTIN" className="min-w-[260px] flex-1"/><Button variant="outline" onClick={()=>setSearch(typedSearch)}><Search className="mr-2 h-4 w-4"/>Buscar</Button></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-muted/50 text-xs uppercase text-muted-foreground"><tr><th className="p-3 text-left"><input aria-label="Selecionar todos" type="checkbox" checked={allSelected} onChange={()=>setSelected(allSelected?[]:items.map(i=>i.id))}/></th><th className="p-3 text-left">Produto</th><th className="p-3 text-left">Códigos</th><th className="p-3 text-left">Sugestão do XML</th><th className="p-3 text-right">Ação</th></tr></thead><tbody>{items.map(p=><tr key={p.id} className="border-t"><td className="p-3"><input aria-label={`Selecionar ${p.name}`} type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)}/></td><td className="p-3"><strong>{p.name}</strong><div className="text-xs text-muted-foreground">{p.sku||"sem SKU"}</div></td><td className="p-3 text-xs">Interno: {p.internal_code||"—"}<br/>Fabricante: {p.manufacturer_code||"—"}<br/>GTIN: {p.gtin||"—"}</td><td className="p-3">{p.candidate?<div><strong>NCM {p.candidate.ncm}</strong><div className="text-xs text-muted-foreground">CFOP de entrada {p.candidate.cfop||"—"}</div></div>:<span className="text-muted-foreground">Sem XML vinculado</span>}</td><td className="p-3 text-right">{p.candidate&&<Button size="sm" variant="outline" onClick={()=>{setSelected([p.id]);setForm(v=>({...v,ncm:p.candidate.ncm}))}}>Usar NCM</Button>}</td></tr>)}</tbody></table>{!query.isLoading&&!items.length&&<p className="py-8 text-center text-sm text-muted-foreground">Nenhum produto pendente encontrado.</p>}</div>
    </section>
    <section className="rounded-2xl border border-primary/30 bg-card p-5"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-700"/><h2 className="font-display text-xl font-bold">Aprovar classificação em lote</h2></div><p className="mt-1 text-sm text-muted-foreground">{qty(selected.length)} produto(s) selecionado(s). Use lote apenas para produtos tributariamente equivalentes.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-4">{field("ncm","NCM (8 dígitos)")}{field("cest","CEST, se aplicável")}<label className="text-xs font-bold uppercase text-muted-foreground">Origem<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.origin} onChange={e=>setForm({...form,origin:Number(e.target.value)})}>{Array.from({length:9},(_,i)=><option key={i} value={i}>{i} — origem {i}</option>)}</select></label>{field("cfopInState","CFOP venda na UF")}{field("cfopOutState","CFOP venda fora da UF")}{field("icmsCsosn","CSOSN")}{field("icmsCst","CST ICMS")}{field("icmsRate","Alíquota ICMS (%)","number")}{field("pisCst","CST PIS")}{field("pisRate","Alíquota PIS (%)","number")}{field("cofinsCst","CST COFINS")}{field("cofinsRate","Alíquota COFINS (%)","number")}</div>
      <label className="mt-3 block text-xs font-bold uppercase text-muted-foreground">Observação<Input className="mt-1" value={form.notes??""} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Referência ou validação da contabilidade"/></label>
      <div className="mt-4 flex justify-end"><Button disabled={!selected.length||save.isPending} onClick={()=>save.mutate()}>{save.isPending?"Aprovando…":`Aprovar ${selected.length} produto(s)`}</Button></div>
    </section>
  </div>;
}
function Metric({label,value,detail,good,warning}:any){return <div className="rounded-2xl border bg-card p-4"><FileSearch className={`h-5 w-5 ${good?"text-emerald-700":warning?"text-amber-700":"text-blue-700"}`}/><div className="mt-2 text-xs font-bold uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div><p className="text-xs text-muted-foreground">{detail}</p></div>}
