import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check, ExternalLink, ImageDown, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addProductEnrichmentCandidate, approveProductEnrichmentCandidate, copyProductEnrichmentImage,
  enqueueMissingProductEnrichment, listProductEnrichmentJobs, processManufacturerEnrichment, rejectProductEnrichmentCandidate,
} from "@/lib/product-enrichment.functions";

export const Route = createFileRoute("/_authenticated/admin/enriquecimento-produtos")({
  head: () => ({ meta: [
    { title: "Enriquecimento de produtos · Admin" },
    { name: "description", content: "Imagens, descrições e códigos com fonte, confiança e aprovação." },
  ] }),
  component: () => <SupplyGuard><EnrichmentPage /></SupplyGuard>,
});

const emptyForm = { sourceType: "manufacturer", sourceUrl: "", imageUrl: "", licenseName: "",
  suggestedName: "", shortDescription: "", description: "", gtin: "", manufacturerCode: "", confidence: "80" };

function EnrichmentPage() {
  const qc=useQueryClient();
  const listFn=useServerFn(listProductEnrichmentJobs);
  const enqueueFn=useServerFn(enqueueMissingProductEnrichment);\n  const processFn=useServerFn(processManufacturerEnrichment);
  const addFn=useServerFn(addProductEnrichmentCandidate);
  const copyFn=useServerFn(copyProductEnrichmentImage);
  const approveFn=useServerFn(approveProductEnrichmentCandidate);
  const rejectFn=useServerFn(rejectProductEnrichmentCandidate);
  const [status,setStatus]=useState("all");
  const [editing,setEditing]=useState<any|null>(null);
  const [form,setForm]=useState(emptyForm);
  const {data,isLoading,isError,error}=useQuery({queryKey:["product-enrichment",status],queryFn:()=>listFn({data:{status}})});
  const refresh=()=>qc.invalidateQueries({queryKey:["product-enrichment"]});

  const enqueue=useMutation({mutationFn:()=>enqueueFn({data:{limit:100}}),onSuccess:r=>{toast.success(`${r.count} produto(s) incluído(s) na fila`);refresh();},onError:(e:Error)=>toast.error(e.message)});\n  const process=useMutation({mutationFn:()=>processFn({data:{limit:3}}),onSuccess:r=>{const review=r.results.filter(v=>v.status==="review").length;toast.success(`${r.processed} processado(s); ${review} enviado(s) para revisão`);refresh();},onError:(e:Error)=>toast.error(e.message)});
  const add=useMutation({mutationFn:()=>addFn({data:{
    jobId:editing.id,productId:editing.product.id,sourceType:form.sourceType as any,sourceUrl:form.sourceUrl,
    imageUrl:form.imageUrl||undefined,licenseName:form.licenseName||undefined,suggestedName:form.suggestedName||undefined,
    shortDescription:form.shortDescription||undefined,description:form.description||undefined,gtin:form.gtin||undefined,
    manufacturerCode:form.manufacturerCode||undefined,confidence:Number(form.confidence)||0,
    matchReasons:["Revisão manual com fonte registrada"],
  }}),onSuccess:()=>{toast.success("Sugestão registrada");setEditing(null);setForm(emptyForm);refresh();},onError:(e:Error)=>toast.error(e.message)});
  const copy=useMutation({mutationFn:(id:string)=>copyFn({data:{candidateId:id}}),onSuccess:()=>{toast.success("Imagem copiada para o armazenamento próprio");refresh();},onError:(e:Error)=>toast.error(e.message)});
  const approve=useMutation({mutationFn:(id:string)=>approveFn({data:{candidateId:id}}),onSuccess:()=>{toast.success("Dados aprovados e aplicados ao produto");refresh();},onError:(e:Error)=>toast.error(e.message)});
  const reject=useMutation({mutationFn:(id:string)=>rejectFn({data:{candidateId:id}}),onSuccess:()=>{toast.success("Sugestão rejeitada");refresh();},onError:(e:Error)=>toast.error(e.message)});
  const rows=(data??[]) as any[];

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-2xl font-bold uppercase">Enriquecimento de produtos</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Fila independente do Bling para localizar, conferir e aprovar imagens, descrições, GTIN e códigos. Nenhuma sugestão altera o catálogo sem aprovação.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={process.isPending} onClick={()=>process.mutate()}><Search className="mr-2 h-4 w-4"/>{process.isPending?"Consultando fontes…":"Processar fabricantes"}</Button><Button disabled={enqueue.isPending} onClick={()=>enqueue.mutate()}><Search className="mr-2 h-4 w-4"/>{enqueue.isPending?"Preparando…":"Enfileirar incompletos"}</Button></div>
    </header>
    <div className="flex gap-2">
      {["all","queued","review","approved","failed"].map(value=><button key={value} onClick={()=>setStatus(value)}
        className={`rounded-md border px-3 py-2 text-xs font-bold uppercase ${status===value?"border-primary bg-primary/10 text-primary":"border-border"}`}>
        {({all:"Todos",queued:"Na fila",review:"Revisão",approved:"Aprovados",failed:"Falhas"} as any)[value]}</button>)}
    </div>
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><strong>Busca segura:</strong> priorize GTIN, código do fabricante e site oficial. Nome sozinho tem baixa confiança. Imagens são copiadas para nosso Storage antes da aprovação.</div>
    {isLoading&&<p className="text-sm text-muted-foreground">Carregando fila…</p>}
    {isError&&<div role="alert" className="rounded-lg border border-destructive p-4 text-sm">{(error as Error).message}</div>}
    <div className="space-y-4">{rows.map(job=><article key={job.id} className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="font-semibold">{job.product?.name}</div><div className="text-xs text-muted-foreground">SKU {job.product?.sku} · GTIN {job.product?.gtin||"não informado"} · Fabricante {job.product?.manufacturer_code||"não informado"}</div>
          <div className="mt-1 text-xs">Busca sugerida: <code>{job.search_query}</code></div></div>
        <div className="flex gap-2"><Status value={job.status}/><a href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(job.search_query||job.product?.name||"")}`} target="_blank" rel="noreferrer"
          className="inline-flex items-center rounded-md border px-3 py-2 text-xs font-semibold">Pesquisar <ExternalLink className="ml-1 h-3 w-3"/></a>
          <Button size="sm" variant="outline" onClick={()=>{setEditing(job);setForm({...emptyForm,suggestedName:job.product?.name||"",gtin:job.product?.gtin||"",manufacturerCode:job.product?.manufacturer_code||""})}}><Plus className="mr-1 h-3 w-3"/>Sugestão</Button></div>
      </div>
      {(job.candidates??[]).length>0&&<div className="mt-4 grid gap-3 lg:grid-cols-2">{job.candidates.map((c:any)=><div key={c.id} className="rounded-md border border-border p-3">
        <div className="flex justify-between gap-2"><div><strong>{c.source_name||c.source_type}</strong><div className="text-xs text-muted-foreground">Confiança {Number(c.confidence).toFixed(0)}% · {c.license_name||"licença não informada"}</div></div><Status value={c.status}/></div>
        {c.image_url&&<img src={c.storage_url||c.image_url} alt="" className="mt-3 h-32 w-full rounded bg-muted object-contain" referrerPolicy="no-referrer"/>}
        <div className="mt-2 text-sm"><div>{c.suggested_name}</div>{c.suggested_description&&<p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.suggested_description}</p>}</div>
        <div className="mt-3 flex flex-wrap gap-2"><a href={c.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded border px-2 py-1 text-xs">Ver fonte</a>
          {c.status==="pending"&&c.image_url&&!c.storage_url&&<Button size="sm" variant="outline" onClick={()=>copy.mutate(c.id)}><ImageDown className="mr-1 h-3 w-3"/>Copiar imagem</Button>}
          {c.status==="pending"&&(!c.image_url||c.storage_url)&&<Button size="sm" onClick={()=>approve.mutate(c.id)}><Check className="mr-1 h-3 w-3"/>Aprovar</Button>}
          {c.status==="pending"&&<Button size="sm" variant="outline" onClick={()=>reject.mutate(c.id)}><X className="mr-1 h-3 w-3"/>Rejeitar</Button>}</div>
      </div>)}</div>}
    </article>)}</div>
    {rows.length===0&&!isLoading&&<div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum produto nesta situação.</div>}
    {editing&&<section className="rounded-lg border border-primary/40 bg-card p-4">
      <h2 className="font-display text-lg font-bold uppercase">Nova sugestão · {editing.product?.name}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="URL da fonte *" value={form.sourceUrl} onChange={v=>setForm({...form,sourceUrl:v})}/>
        <Field label="URL da imagem" value={form.imageUrl} onChange={v=>setForm({...form,imageUrl:v})}/>
        <label className="text-xs font-semibold uppercase text-muted-foreground">Tipo da fonte<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.sourceType} onChange={e=>setForm({...form,sourceType:e.target.value})}>
          <option value="manufacturer">Fabricante</option><option value="supplier">Fornecedor</option><option value="authorized_distributor">Distribuidor autorizado</option><option value="gs1">GS1</option><option value="web">Internet</option><option value="manual">Manual</option><option value="bling">Bling (temporário)</option></select></label>
        <Field label="Licença/autorização" value={form.licenseName} onChange={v=>setForm({...form,licenseName:v})}/>
        <Field label="Nome sugerido" value={form.suggestedName} onChange={v=>setForm({...form,suggestedName:v})}/>
        <Field label="Descrição curta" value={form.shortDescription} onChange={v=>setForm({...form,shortDescription:v})}/>
        <Field label="GTIN" value={form.gtin} onChange={v=>setForm({...form,gtin:v})}/>
        <Field label="Código fabricante" value={form.manufacturerCode} onChange={v=>setForm({...form,manufacturerCode:v})}/>
        <Field label="Confiança (0–100)" value={form.confidence} onChange={v=>setForm({...form,confidence:v})}/>
        <label className="text-xs font-semibold uppercase text-muted-foreground sm:col-span-2">Descrição completa<textarea className="mt-1 min-h-28 w-full rounded-md border bg-background p-3 text-sm" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      </div><div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={()=>setEditing(null)}>Cancelar</Button><Button disabled={add.isPending||!form.sourceUrl} onClick={()=>add.mutate()}>Salvar para revisão</Button></div>
    </section>}
  </div>;
}
function Field({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <label className="text-xs font-semibold uppercase text-muted-foreground">{label}<Input className="mt-1" value={value} onChange={e=>onChange(e.target.value)}/></label>}
function Status({value}:{value:string}){const labels:any={queued:"Na fila",processing:"Processando",review:"Revisão",approved:"Aprovado",failed:"Falha",pending:"Pendente",rejected:"Rejeitado"};return <span className="h-fit rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase">{labels[value]||value}</span>}
