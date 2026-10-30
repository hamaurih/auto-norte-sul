import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CreditCard, FileText, Landmark, ShoppingCart, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { brl } from "@/lib/format";
import { convertMyQuoteToPurchase, getMyQuotes } from "@/lib/my-quotes.functions";

export const Route=createFileRoute("/_authenticated/orcamentos")({
  head:()=>({meta:[{title:"Meus orçamentos · Norte Sul"}]}),
  component:MyQuotesPage,
});

const statusLabel:Record<string,string>={
  rascunho:"Em preparação",enviado:"Disponível para compra",em_negociacao:"Em negociação",
  aprovado:"Aprovado",convertido:"Transformado em compra",recusado:"Recusado",expirado:"Expirado",
};

function MyQuotesPage(){
  const navigate=useNavigate();
  const qc=useQueryClient();
  const listFn=useServerFn(getMyQuotes);
  const convertFn=useServerFn(convertMyQuoteToPurchase);
  const [payment,setPayment]=useState<Record<string,"pix"|"cartao"|"boleto">>({});

  const query=useQuery({
    queryKey:["my-quotes"],
    queryFn:()=>listFn(),
  });

  const convert=useMutation({
    mutationFn:({quoteId,paymentMethod}:{quoteId:string;paymentMethod:"pix"|"cartao"|"boleto"})=>
      convertFn({data:{quoteId,paymentMethod}}),
    onSuccess:async(result:any)=>{
      await qc.invalidateQueries({queryKey:["my-quotes"]});
      toast.success("Orçamento transformado em compra. Escolha os dados finais e conclua o pagamento.");
      navigate({to:"/checkout",search:{pedido:result.order_id} as never});
    },
    onError:(error:Error)=>toast.error(error.message),
  });

  const rows=(query.data??[]) as any[];

  return <div className="container-x py-6">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Área do cliente</p>
        <h1 className="mt-1 font-display text-3xl font-bold uppercase">Meus orçamentos</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Orçamentos liberados podem ser transformados em compra sem refazer o carrinho.
          O estoque é conferido novamente no momento da conversão.
        </p>
      </div>
      <Link to="/pedidos" className="rounded-md border px-4 py-2 text-sm font-bold">
        Meus pedidos
      </Link>
    </div>

    {query.isLoading?<p className="text-sm text-muted-foreground">Carregando orçamentos…</p>:
     query.isError?<div className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm text-destructive">
       Não foi possível carregar seus orçamentos.
     </div>:
     !rows.length?<div className="rounded-xl border border-dashed p-10 text-center">
       <FileText className="mx-auto h-8 w-8 text-muted-foreground"/>
       <p className="mt-3 font-semibold">Você ainda não possui orçamentos vinculados à sua conta.</p>
     </div>:
     <div className="space-y-4">
       {rows.map((quote:any)=>{
         const method=payment[quote.id]??"pix";
         return <article key={quote.id} className="rounded-2xl border bg-card p-5 shadow-sm">
           <div className="flex flex-wrap items-start justify-between gap-4">
             <div>
               <div className="flex flex-wrap items-center gap-2">
                 <strong className="font-display text-xl">Orçamento #{quote.number}</strong>
                 <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                   {statusLabel[quote.status]??quote.status}
                 </span>
               </div>
               <p className="mt-1 text-xs text-muted-foreground">
                 {quote.valid_until
                   ? "Válido até "+new Date(quote.valid_until).toLocaleDateString("pt-BR")
                   : "Sem data de validade definida"}
               </p>
             </div>
             <div className="text-right">
               <p className="text-xs font-bold uppercase text-muted-foreground">Total</p>
               <p className="price-tag text-2xl">{brl(Number(quote.total??0))}</p>
             </div>
           </div>

           <div className="mt-4 overflow-hidden rounded-xl border">
             {(quote.quote_items??[]).map((item:any)=>(
               <div key={item.id} className="flex items-center justify-between gap-4 border-b p-3 text-sm last:border-0">
                 <div>
                   <strong>{item.name}</strong>
                   <div className="text-xs text-muted-foreground">{item.qty} × {brl(Number(item.unit_price))}</div>
                 </div>
                 <strong>{brl(Number(item.total??0))}</strong>
               </div>
             ))}
           </div>

           {quote.order_id?(
             <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
               <div>
                 <p className="font-bold text-emerald-900">Este orçamento já virou pedido.</p>
                 <p className="text-xs text-emerald-800">Continue o pagamento sem montar o carrinho novamente.</p>
               </div>
               <Link
                 to="/checkout"
                 search={{pedido:quote.order_id} as never}
                 className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
               >
                 Continuar pagamento
               </Link>
             </div>
           ):quote.can_buy?(
             <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
               <p className="font-bold">Transformar orçamento em compra</p>
               <p className="mt-1 text-xs text-muted-foreground">
                 O sistema confirma o estoque em tempo real e reserva as peças antes de criar o pedido.
               </p>
               <div className="mt-3 grid gap-2 sm:grid-cols-3">
                 {([
                   ["pix","PIX",Smartphone],
                   ["cartao","Cartão",CreditCard],
                   ["boleto","Boleto",Landmark],
                 ] as const).map(([value,label,Icon])=>(
                   <button key={value} type="button"
                     onClick={()=>setPayment(current=>({...current,[quote.id]:value}))}
                     className={"flex items-center gap-2 rounded-lg border p-3 text-left text-sm font-bold "+
                       (method===value?"border-primary bg-background text-primary":"bg-background")}
                   >
                     <Icon className="h-4 w-4"/>{label}
                   </button>
                 ))}
               </div>
               <button
                 type="button"
                 disabled={convert.isPending}
                 onClick={()=>{
                   if(!window.confirm("Confirmar a transformação deste orçamento em pedido de compra? O estoque será reservado agora.")) return;
                   convert.mutate({quoteId:quote.id,paymentMethod:method});
                 }}
                 className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50"
               >
                 <ShoppingCart className="h-4 w-4"/>
                 {convert.isPending?"Validando estoque…":"Transformar orçamento em compra"}
               </button>
             </div>
           ):(
             <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
               {quote.expired
                 ?"Este orçamento venceu. Solicite uma atualização para concluir a compra."
                 :"Este orçamento ainda não está liberado para compra."}
             </div>
           )}
         </article>;
       })}
     </div>}
  </div>;
}
