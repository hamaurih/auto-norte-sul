import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { CheckCircle2, PlusCircle, Search, Trophy } from "lucide-react";
import { toast } from "sonner";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { brl } from "@/lib/format";
import {
  convertSupplierQuoteToPurchaseOrder,
  getPurchaseQuotation,
  listPurchaseQuotations,
  savePurchaseQuotation,
  saveSupplierQuote,
} from "@/lib/purchase-quotations.functions";
import { listSuppliers, listSupplyWarehouses, searchSupplyProducts } from "@/lib/supplies.functions";

export const Route=createFileRoute("/_authenticated/admin/cotacoes-compra")({
  head:()=>({meta:[{title:"Cotações de compra · Norte Sul"}]}),
  component:()=> <SupplyGuard><PurchaseQuotationsPage/></SupplyGuard>,
});

type DraftItem={product_id:string;name:string;sku?:string|null;requested_qty:number};

function PurchaseQuotationsPage(){
  const qc=useQueryClient();
  const listFn=useServerFn(listPurchaseQuotations);
  const getFn=useServerFn(getPurchaseQuotation);
  const saveFn=useServerFn(savePurchaseQuotation);
  const quoteFn=useServerFn(saveSupplierQuote);
  const convertFn=useServerFn(convertSupplierQuoteToPurchaseOrder);
  const suppliersFn=useServerFn(listSuppliers);
  const warehousesFn=useServerFn(listSupplyWarehouses);
  const productsFn=useServerFn(searchSupplyProducts);

  const [selectedId,setSelectedId]=useState("");
  const [title,setTitle]=useState("");
  const [warehouseId,setWarehouseId]=useState("");
  const [needBy,setNeedBy]=useState("");
  const [search,setSearch]=useState("");
  const [items,setItems]=useState<DraftItem[]>([]);
  const [supplierId,setSupplierId]=useState("");
  const [deliveryDays,setDeliveryDays]=useState(0);
  const [paymentTerms,setPaymentTerms]=useState("");
  const [freight,setFreight]=useState(0);
  const [discount,setDiscount]=useState(0);
  const [other,setOther]=useState(0);
  const [prices,setPrices]=useState<Record<string,{qty:number;cost:number}>>({});

  const q=useQuery({queryKey:["purchase-quotations"],queryFn:()=>listFn()});
  const suppliers=useQuery({queryKey:["suppliers-active"],queryFn:()=>suppliersFn({data:{onlyActive:true}})});
  const warehouses=useQuery({queryKey:["supply-warehouses"],queryFn:()=>warehousesFn()});
  const products=useQuery({
    queryKey:["quotation-product-search",search],
    queryFn:()=>productsFn({data:{search}}),
    enabled:search.trim().length>=2,
  });
  const detail=useQuery({
    queryKey:["purchase-quotation",selectedId],
    queryFn:()=>getFn({data:{id:selectedId}}),
    enabled:Boolean(selectedId),
  });

  const refresh=()=>{qc.invalidateQueries({queryKey:["purchase-quotations"]}); if(selectedId) qc.invalidateQueries({queryKey:["purchase-quotation",selectedId]})};

  const create=useMutation({
    mutationFn:()=>saveFn({data:{
      warehouse_id:warehouseId,title,requested_by_date:needBy||null,
      items:items.map(x=>({product_id:x.product_id,requested_qty:x.requested_qty})),
    }}),
    onSuccess:(r:any)=>{toast.success("Cotação criada");setTitle("");setNeedBy("");setItems([]);setSearch("");setSelectedId(r.id);refresh()},
    onError:(e:Error)=>toast.error(e.message),
  });

  const saveQuote=useMutation({
    mutationFn:()=>{
      if(!detail.data) throw new Error("Selecione uma cotação");
      return quoteFn({data:{
        quotation_id:detail.data.quotation.id,supplier_id:supplierId,payment_terms:paymentTerms||undefined,
        delivery_days:deliveryDays,freight_amount:freight,discount_amount:discount,other_amount:other,
        items:detail.data.items.map((x:any)=>{
          const p=prices[x.id]??{qty:Number(x.requested_qty),cost:0};
          return {quotation_item_id:x.id,product_id:x.product_id,offered_qty:Number(p.qty),unit_cost:Number(p.cost)};
        }),
      }});
    },
    onSuccess:()=>{toast.success("Proposta registrada");setSupplierId("");setPaymentTerms("");setDeliveryDays(0);setFreight(0);setDiscount(0);setOther(0);setPrices({});refresh()},
    onError:(e:Error)=>toast.error(e.message),
  });

  const convert=useMutation({
    mutationFn:(supplierQuoteId:string)=>convertFn({data:{supplierQuoteId}}),
    onSuccess:(r:any)=>{toast.success("Proposta convertida em pedido de compra #"+(r.purchase_order_number??""));refresh()},
    onError:(e:Error)=>toast.error(e.message),
  });

  const ranked=useMemo(()=>{
    const rows=(detail.data?.quotes??[]).map((x:any)=>({
      ...x,
      score:Number(x.total_amount??0)+(Number(x.delivery_days??0)*0.01),
    }));
    return rows.sort((a:any,b:any)=>a.score-b.score);
  },[detail.data?.quotes]);

  const addProduct=(p:any)=>{
    if(items.some(x=>x.product_id===p.id)) return;
    setItems(v=>[...v,{product_id:p.id,name:p.name,sku:p.sku??p.internal_code,requested_qty:1}]);
    setSearch("");
  };

  return <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-amber-700">Suprimentos</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold">Cotação de compra</h1>
        <p className="mt-1 text-sm text-muted-foreground">Compare fornecedores por custo total, prazo e condição de pagamento e gere o pedido sem redigitação.</p>
      </div>
      <Link to="/admin/pedidos-compra" className="rounded-xl border bg-white px-4 py-2.5 text-sm font-bold">Pedidos de compra</Link>
    </header>

    <section className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <aside className="space-y-4">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-bold">Nova cotação</h2>
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium">Título
              <input className="mt-1 w-full rounded-xl border px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex.: Reposição filtros e pastilhas"/>
            </label>
            <label className="block text-sm font-medium">Depósito
              <select className="mt-1 w-full rounded-xl border px-3 py-2" value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}>
                <option value="">Selecione…</option>
                {(warehouses.data??[]).map((w:any)=><option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">Necessidade até
              <input type="date" className="mt-1 w-full rounded-xl border px-3 py-2" value={needBy} onChange={e=>setNeedBy(e.target.value)}/>
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/>
              <input className="w-full rounded-xl border py-2 pl-9 pr-3 text-sm" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto…"/>
              {search.trim().length>=2&&(products.data??[]).length>0&&<div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border bg-white shadow-lg">
                {(products.data??[]).map((p:any)=><button key={p.id} type="button" onClick={()=>addProduct(p)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <b>{p.name}</b><div className="text-xs text-slate-500">{p.sku??p.internal_code??""}</div>
                </button>)}
              </div>}
            </div>
            <div className="space-y-2">
              {items.map((x,i)=><div key={x.product_id} className="grid grid-cols-[1fr_90px_32px] items-center gap-2 rounded-xl border p-2">
                <div className="min-w-0"><b className="block truncate text-sm">{x.name}</b><span className="text-xs text-slate-500">{x.sku??""}</span></div>
                <input type="number" min={0.001} step="0.001" className="rounded-lg border px-2 py-1.5 text-right text-sm" value={x.requested_qty} onChange={e=>setItems(v=>v.map((it,idx)=>idx===i?{...it,requested_qty:Number(e.target.value)||0}:it))}/>
                <button type="button" className="text-slate-400" onClick={()=>setItems(v=>v.filter((_,idx)=>idx!==i))}>×</button>
              </div>)}
            </div>
            <button disabled={!warehouseId||title.trim().length<3||items.length===0||create.isPending} onClick={()=>create.mutate()} className="w-full rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              <PlusCircle className="mr-2 inline h-4 w-4"/> Criar cotação
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-3 shadow-sm">
          <div className="px-2 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">Cotações</div>
          <div className="space-y-1">
            {(q.data??[]).map((x:any)=><button key={x.id} type="button" onClick={()=>{setSelectedId(x.id);setPrices({})}} className={"w-full rounded-xl px-3 py-2 text-left "+(selectedId===x.id?"bg-amber-50 ring-1 ring-amber-200":"hover:bg-slate-50")}>
              <div className="flex items-center justify-between gap-2"><b className="text-sm">#{x.number} · {x.title}</b><span className="text-[11px] uppercase text-slate-500">{x.status}</span></div>
              <div className="text-xs text-slate-500">{x.warehouse?.name??"Depósito"}</div>
            </button>)}
          </div>
        </div>
      </aside>

      <main className="space-y-5">
        {!selectedId&&<div className="rounded-2xl border border-dashed bg-white p-10 text-center text-sm text-muted-foreground">Crie ou selecione uma cotação para comparar fornecedores.</div>}
        {detail.data&&<>
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="text-xs font-bold uppercase text-amber-700">Cotação #{detail.data.quotation.number}</div><h2 className="font-display text-2xl font-extrabold">{detail.data.quotation.title}</h2><p className="text-sm text-slate-500">{detail.data.quotation.warehouse?.name}</p></div>
              {detail.data.quotation.purchase_order_id&&<Link to="/admin/pedidos-compra/$id" params={{id:detail.data.quotation.purchase_order_id}} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Ver pedido gerado</Link>}
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[620px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Produto</th><th className="p-3 text-right">Qtd.</th><th className="p-3 text-right">Custo médio</th><th className="p-3 text-right">Último custo</th></tr></thead>
                <tbody className="divide-y">{detail.data.items.map((x:any)=><tr key={x.id}><td className="p-3"><b>{x.product?.name}</b><div className="text-xs text-slate-500">{x.product?.sku??x.product?.internal_code??""}</div></td><td className="p-3 text-right">{Number(x.requested_qty)}</td><td className="p-3 text-right">{brl(Number(x.product?.average_cost??0))}</td><td className="p-3 text-right">{brl(Number(x.product?.last_purchase_cost??0))}</td></tr>)}</tbody>
              </table>
            </div>
          </section>

          {detail.data.quotation.status!=="converted"&&<section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h3 className="font-display text-lg font-bold">Registrar proposta de fornecedor</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <label className="text-sm font-medium md:col-span-2">Fornecedor
                <select className="mt-1 w-full rounded-xl border px-3 py-2" value={supplierId} onChange={e=>setSupplierId(e.target.value)}>
                  <option value="">Selecione…</option>{(suppliers.data??[]).map((s:any)=><option key={s.id} value={s.id}>{s.trade_name||s.legal_name}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">Prazo (dias)<input type="number" min={0} className="mt-1 w-full rounded-xl border px-3 py-2" value={deliveryDays} onChange={e=>setDeliveryDays(Number(e.target.value)||0)}/></label>
              <label className="text-sm font-medium">Condição de pagamento<input className="mt-1 w-full rounded-xl border px-3 py-2" value={paymentTerms} onChange={e=>setPaymentTerms(e.target.value)} placeholder="28/35/42 dias"/></label>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[650px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Produto</th><th className="p-3 text-right">Solicitado</th><th className="p-3 text-right">Ofertado</th><th className="p-3 text-right">Preço unit.</th><th className="p-3 text-right">Subtotal</th></tr></thead>
                <tbody className="divide-y">{detail.data.items.map((x:any)=>{
                  const p=prices[x.id]??{qty:Number(x.requested_qty),cost:0};
                  return <tr key={x.id}><td className="p-3 font-medium">{x.product?.name}</td><td className="p-3 text-right">{Number(x.requested_qty)}</td><td className="p-3 text-right"><input type="number" min={0} step=".001" className="w-24 rounded-lg border px-2 py-1.5 text-right" value={p.qty} onChange={e=>setPrices(v=>({...v,[x.id]:{qty:Number(e.target.value)||0,cost:(v[x.id]??p).cost}}))}/></td><td className="p-3 text-right"><input type="number" min={0} step=".01" className="w-28 rounded-lg border px-2 py-1.5 text-right" value={p.cost} onChange={e=>setPrices(v=>({...v,[x.id]:{qty:(v[x.id]??p).qty,cost:Number(e.target.value)||0}}))}/></td><td className="p-3 text-right font-semibold">{brl(p.qty*p.cost)}</td></tr>;
                })}</tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-medium">Frete<input type="number" min={0} step=".01" className="mt-1 w-full rounded-xl border px-3 py-2" value={freight} onChange={e=>setFreight(Number(e.target.value)||0)}/></label>
              <label className="text-sm font-medium">Desconto<input type="number" min={0} step=".01" className="mt-1 w-full rounded-xl border px-3 py-2" value={discount} onChange={e=>setDiscount(Number(e.target.value)||0)}/></label>
              <label className="text-sm font-medium">Outros custos<input type="number" min={0} step=".01" className="mt-1 w-full rounded-xl border px-3 py-2" value={other} onChange={e=>setOther(Number(e.target.value)||0)}/></label>
            </div>
            <div className="mt-4 flex justify-end"><button disabled={!supplierId||saveQuote.isPending} onClick={()=>saveQuote.mutate()} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Salvar proposta</button></div>
          </section>}

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><div><h3 className="font-display text-lg font-bold">Comparativo de fornecedores</h3><p className="text-sm text-slate-500">Ordenado pelo menor custo total; prazo e condição de pagamento permanecem visíveis para decisão.</p></div>{ranked.length>0&&<Trophy className="h-5 w-5 text-amber-600"/>}</div>
            <div className="mt-4 space-y-3">
              {ranked.length===0&&<p className="text-sm text-muted-foreground">Nenhuma proposta registrada.</p>}
              {ranked.map((x:any,i:number)=><div key={x.id} className={"rounded-2xl border p-4 "+(i===0?"border-emerald-300 bg-emerald-50/40":"bg-white")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex items-center gap-2"><b>{x.supplier?.trade_name||x.supplier?.legal_name}</b>{i===0&&<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">MENOR CUSTO</span>}</div><div className="mt-1 text-xs text-slate-500">Prazo: {x.delivery_days??"—"} dias · Pagamento: {x.payment_terms||"—"}</div></div>
                  <div className="text-right">
                    <div className="text-xl font-extrabold">{brl(Number(x.total_amount??0))}</div>
                    <div className="text-xs text-slate-500">
                      Itens {brl(Number(x.items_total??0))} + frete {brl(Number(x.freight_amount??0))}
                      {" "}+ outros {brl(Number(x.other_amount??0))} − desconto {brl(Number(x.discount_amount??0))}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">{detail.data.quotation.status!=="converted"&&<button disabled={convert.isPending} onClick={()=>convert.mutate(x.id)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><CheckCircle2 className="mr-2 inline h-4 w-4"/>Selecionar e gerar pedido</button>}</div>
              </div>)}
            </div>
          </section>
        </>}
      </main>
    </section>
  </div>;
}
