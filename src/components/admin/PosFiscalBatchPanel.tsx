import { useMemo,useState } from "react";
import { useQuery,useMutation,useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import { listPosFiscalCandidates,listPosFiscalBatches,createPosFiscalBatch } from "@/lib/pos-fiscal-batches.functions";

export function PosFiscalBatchPanel(){
 const qc=useQueryClient();
 const candidatesFn=useServerFn(listPosFiscalCandidates);
 const batchesFn=useServerFn(listPosFiscalBatches);
 const createFn=useServerFn(createPosFiscalBatch);
 const [selected,setSelected]=useState<string[]>([]);
 const candidates=useQuery({queryKey:["pos-fiscal-candidates"],queryFn:()=>candidatesFn()});
 const batches=useQuery({queryKey:["pos-fiscal-batches"],queryFn:()=>batchesFn()});
 const rows=(candidates.data??[]) as any[];
 const selectedRows=useMemo(()=>rows.filter(r=>selected.includes(r.id)),[rows,selected]);
 const total=selectedRows.reduce((n,r)=>n+Number(r.total??0),0);
 const customerIds=[...new Set(selectedRows.map(r=>r.customer_id??"__anonymous"))];
 const sameCustomer=customerIds.length<=1;
 const submit=useMutation({
  mutationFn:()=>createFn({data:{saleIds:selected}}),
  onSuccess:()=>{
   toast.success("Recibos vinculados a uma solicitação de análise fiscal");
   setSelected([]);
   void qc.invalidateQueries({queryKey:["pos-fiscal-candidates"]});
   void qc.invalidateQueries({queryKey:["pos-fiscal-batches"]});
  },
  onError:(e:Error)=>toast.error(e.message),
 });
 return <section className="space-y-4 rounded-2xl border bg-card p-5">
  <div><h2 className="text-xl font-bold">Vincular recibos do PDV</h2>
  <p className="mt-1 text-sm text-muted-foreground">Selecione as vendas concluídas do mesmo cliente. A vinculação apenas prepara a análise: não gera NF-e, NFC-e nem movimenta novamente estoque ou caixa.</p></div>
  {candidates.isError&&<p role="alert" className="text-sm text-destructive">Não foi possível carregar os recibos: {String((candidates.error as Error)?.message)}</p>}
  <div className="max-h-80 space-y-2 overflow-y-auto">
   {rows.map(r=><label key={r.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm">
    <span className="flex items-center gap-3"><input type="checkbox" checked={selected.includes(r.id)}
     onChange={e=>setSelected(old=>e.target.checked?[...old,r.id]:old.filter(id=>id!==r.id))}/>
     <span><strong>Recibo {String(r.id).slice(0,8).toUpperCase()}</strong><br/>
      <span className="text-muted-foreground">{r.customer_name} · {new Date(r.created_at).toLocaleString("pt-BR")}</span></span></span>
    <strong>{brl(Number(r.total??0))}</strong>
   </label>)}
   {!candidates.isLoading&&!rows.length&&!candidates.isError&&<p className="text-sm text-muted-foreground">Nenhuma venda elegível encontrada nas 200 vendas recentes.</p>}
  </div>
  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
   <div><strong>{selected.length} selecionado(s) · {brl(total)}</strong>
    {!sameCustomer&&<p className="text-sm text-destructive">Selecione somente recibos do mesmo cliente.</p>}</div>
   <Button disabled={!selected.length||!sameCustomer||submit.isPending} onClick={()=>submit.mutate()}>
    {submit.isPending?"Vinculando…":"Criar solicitação de faturamento"}
   </Button>
  </div>
  <div className="space-y-2 border-t pt-4">
   <h3 className="font-semibold">Solicitações em análise</h3>
   {(batches.data??[]).map((b:any)=><div key={b.id} className="rounded-lg bg-muted/50 p-3 text-sm">
    <strong>Lote {String(b.id).slice(0,8).toUpperCase()}</strong> · {b.sale_ids?.length??0} recibo(s) · {b.status==="pending_review"?"Aguardando análise fiscal":b.status}
    <div className="text-xs text-muted-foreground">Criado em {new Date(b.created_at).toLocaleString("pt-BR")}</div>
   </div>)}
   {batches.isError&&<p role="alert" className="text-sm text-destructive">Erro ao consultar lotes fiscais.</p>}
  </div>
 </section>;
}
