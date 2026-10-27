import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw, Truck } from "lucide-react";
import { toast } from "sonner";
import {
  confirmSupplierReturn,
  getReturnableReceipt,
  listSupplierReturns,
  resolveReceiptDiscrepancy,
  saveSupplierReturn,
} from "@/lib/procurement-returns.functions";
import { brl } from "@/lib/format";

export const Route=createFileRoute("/_authenticated/admin/devolucoes-fornecedor")({
  head:()=>({meta:[{title:"Devoluções a fornecedor · Norte Sul"}]}),
  component:SupplierReturnsPage,
});

function SupplierReturnsPage(){
  const qc=useQueryClient();
  const listFn=useServerFn(listSupplierReturns);
  const receiptFn=useServerFn(getReturnableReceipt);
  const saveFn=useServerFn(saveSupplierReturn);
  const confirmFn=useServerFn(confirmSupplierReturn);
  const resolveFn=useServerFn(resolveReceiptDiscrepancy);
  const [receiptId,setReceiptId]=useState("");
  const [reason,setReason]=useState("");
  const [documentNumber,setDocumentNumber]=useState("");
  const [notes,setNotes]=useState("");
  const [qty,setQty]=useState<Record<string,number>>({});

  const q=useQuery({queryKey:["supplier-returns"],queryFn:()=>listFn()});
  const detail=useQuery({
    queryKey:["supplier-return-receipt",receiptId],
    queryFn:()=>receiptFn({data:{receiptId}}),
    enabled:Boolean(receiptId),
  });
  const selectedItems=useMemo(()=>(
    (detail.data?.items??[])
      .map((x:any)=>({...x,quantity:Math.max(0,Math.trunc(Number(qty[x.id]??0)))}))
      .filter((x:any)=>x.quantity>0)
  ),[detail.data,qty]);
  const total=selectedItems.reduce((s:number,x:any)=>s+x.quantity*Number(x.acquisition_unit_cost??x.unit_cost??0),0);
  const refresh=()=>qc.invalidateQueries({queryKey:["supplier-returns"]});

  const create=useMutation({
    mutationFn:()=>saveFn({data:{
      goods_receipt_id:receiptId,reason,document_number:documentNumber||undefined,notes:notes||undefined,
      items:selectedItems.map((x:any)=>({
        goods_receipt_item_id:x.id,product_id:x.product_id,quantity:x.quantity,
        unit_cost:Number(x.acquisition_unit_cost??x.unit_cost??0),reason,
      })),
    }}),
    onSuccess:()=>{toast.success("Devolução criada em rascunho");setReceiptId("");setReason("");setDocumentNumber("");setNotes("");setQty({});refresh()},
    onError:(e:Error)=>toast.error(e.message),
  });
  const confirm=useMutation({
    mutationFn:(id:string)=>confirmFn({data:{id}}),
    onSuccess:()=>{toast.success("Devolução confirmada: estoque e financeiro atualizados");refresh()},
    onError:(e:Error)=>toast.error(e.message),
  });
  const resolve=useMutation({
    mutationFn:({id,status}:{id:string;status:"resolved"|"waived"})=>{
      const resolution=window.prompt(status==="resolved"?"Como a divergência foi resolvida?":"Motivo para dispensar a divergência?");
      if(!resolution||resolution.trim().length<3) throw new Error("Informe a resolução");
      return resolveFn({data:{id,status,notes:resolution.trim()}});
    },
    onSuccess:()=>{toast.success("Divergência atualizada");refresh()},
    onError:(e:Error)=>toast.error(e.message),
  });
  const openDiscrepancies=(q.data?.discrepancies??[]).filter((x:any)=>x.status==="open");

  return <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <header>
      <p className="text-xs font-bold uppercase tracking-[.18em] text-amber-700">Suprimentos</p>
      <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-extrabold">
        <RotateCcw className="h-7 w-7 text-amber-600"/> Devoluções e divergências
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Devolução ao fornecedor com baixa transacional do estoque, compensação financeira e trilha de auditoria.
      </p>
    </header>

    <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Nova devolução</h2>
        <p className="mt-1 text-sm text-muted-foreground">Somente recebimentos já confirmados aparecem para seleção.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Recebimento
            <select className="mt-1 w-full rounded-xl border px-3 py-2" value={receiptId} onChange={e=>{setReceiptId(e.target.value);setQty({})}}>
              <option value="">Selecione…</option>
              {(q.data?.receipts??[]).map((r:any)=><option key={r.id} value={r.id}>
                #{r.number} · {r.supplier?.legal_name??"Fornecedor"}{r.invoice_number?" · NF "+r.invoice_number:""}
              </option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Documento / crédito
            <input className="mt-1 w-full rounded-xl border px-3 py-2" value={documentNumber} onChange={e=>setDocumentNumber(e.target.value)} placeholder="NF devolução, protocolo…"/>
          </label>
        </div>
        <label className="mt-3 block text-sm font-medium">Motivo
          <input className="mt-1 w-full rounded-xl border px-3 py-2" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ex.: peça avariada, item incorreto, excesso…"/>
        </label>

        {detail.isLoading&&<p className="mt-4 text-sm text-muted-foreground">Carregando itens do recebimento…</p>}
        {detail.data&&<div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-3">Produto</th><th className="p-3 text-right">Recebido</th><th className="p-3 text-right">Disponível p/ devolução</th><th className="p-3 text-right">Custo</th><th className="p-3 text-right">Devolver</th></tr>
            </thead>
            <tbody className="divide-y">
              {(detail.data.items??[]).map((x:any)=><tr key={x.id}>
                <td className="p-3"><b>{x.product?.name??"Produto"}</b><div className="text-xs text-slate-500">{x.product?.sku??x.product?.internal_code??""}</div></td>
                <td className="p-3 text-right">{Number(x.accepted_qty??0)}</td>
                <td className="p-3 text-right">{Number(x.returnable_qty??0)}</td>
                <td className="p-3 text-right">{brl(Number(x.acquisition_unit_cost??x.unit_cost??0))}</td>
                <td className="p-3 text-right">
                  <input type="number" min={0} max={Number(x.returnable_qty??0)} step={1}
                    className="w-24 rounded-lg border px-2 py-1.5 text-right"
                    value={qty[x.id]??0}
                    onChange={e=>setQty(v=>({...v,[x.id]:Math.min(Number(x.returnable_qty??0),Math.max(0,Math.trunc(Number(e.target.value)||0)))}))}
                  />
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>}

        <label className="mt-3 block text-sm font-medium">Observações
          <textarea className="mt-1 min-h-20 w-full rounded-xl border px-3 py-2" value={notes} onChange={e=>setNotes(e.target.value)} />
        </label>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div><span className="text-xs uppercase text-slate-500">Crédito estimado</span><div className="text-xl font-extrabold">{brl(total)}</div></div>
          <button disabled={!receiptId||reason.trim().length<3||selectedItems.length===0||create.isPending}
            onClick={()=>create.mutate()}
            className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            Criar devolução
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-display text-lg font-bold">Divergências abertas</h2><p className="text-sm text-muted-foreground">Geradas na confirmação do recebimento.</p></div>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-800">{openDiscrepancies.length}</span>
        </div>
        <div className="mt-4 space-y-2">
          {openDiscrepancies.length===0&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4"/>Nenhuma divergência pendente.</div>}
          {openDiscrepancies.map((d:any)=><div key={d.id} className="rounded-xl border p-3">
            <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600"/><div className="min-w-0"><b className="text-sm">{d.type==="cost_variance"?"Divergência de custo":"Quantidade rejeitada"}</b><p className="text-xs text-slate-500">{d.description}</p>
              {d.expected_value!=null&&<p className="mt-1 text-xs">Esperado: {d.expected_value} · Recebido: {d.actual_value}</p>}
            </div></div>
            <div className="mt-3 flex gap-2">
              <button onClick={()=>resolve.mutate({id:d.id,status:"resolved"})} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Resolver</button>
              <button onClick={()=>resolve.mutate({id:d.id,status:"waived"})} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-slate-500">Dispensar</button>
            </div>
          </div>)}
        </div>
      </div>
    </section>

    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2"><Truck className="h-5 w-5 text-amber-600"/><h2 className="font-display text-lg font-bold">Histórico de devoluções</h2></div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Nº</th><th>Fornecedor</th><th>Status</th><th>Motivo</th><th className="text-right">Valor</th><th className="text-right">Ação</th></tr></thead>
          <tbody className="divide-y">
            {(q.data?.returns??[]).map((r:any)=><tr key={r.id}>
              <td className="py-3 font-bold">#{r.number}</td><td>{r.supplier?.legal_name??"Fornecedor"}</td>
              <td><span className={"rounded-full px-2.5 py-1 text-xs font-bold "+(r.status==="confirmed"?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-700")}>{r.status==="confirmed"?"Confirmada":"Rascunho"}</span></td>
              <td>{r.reason}</td><td className="text-right font-semibold">{brl(Number(r.total_amount??0))}</td>
              <td className="text-right">{r.status==="draft"&&<button disabled={confirm.isPending} onClick={()=>confirm.mutate(r.id)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">Confirmar</button>}</td>
            </tr>)}
            {!q.isLoading&&(q.data?.returns??[]).length===0&&<tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Nenhuma devolução registrada.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>
}
