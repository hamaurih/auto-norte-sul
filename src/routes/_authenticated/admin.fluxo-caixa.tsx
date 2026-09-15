import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDownRight, ArrowUpRight, Landmark, WalletCards } from "lucide-react";
import { getCashFlow } from "@/lib/financial.functions";
import { brl } from "@/lib/format";

export const Route=createFileRoute("/_authenticated/admin/fluxo-caixa")({
  head:()=>({meta:[{title:"Fluxo de caixa · Norte Sul"}]}),
  component:CashFlow,
});

const date=(v:string)=>new Date(v+"T12:00:00").toLocaleDateString("pt-BR");
const reconLabel=(s:string)=>s==="matched"?"Conciliado":s==="partial"?"Parcial":s==="ignored"?"Ignorado":"Pendente";

function CashFlow(){
  const get=useServerFn(getCashFlow);
  const q=useQuery({queryKey:["cash-flow"],queryFn:()=>get()});
  const receivables=q.data?.receivables??[];
  const expenses=q.data?.expenses??[];
  const transactions=q.data?.transactions??[];
  const accounts=q.data?.summary?.accounts??[];
  const summary=q.data?.summary?.summary??{};
  const incomingOpen=receivables.reduce((s:number,x:any)=>s+Math.max(Number(x.amount)-Number(x.received_amount??0),0),0);
  const outOpen=expenses.reduce((s:number,x:any)=>s+Math.max(Number(x.amount)-Number(x.paid_amount??0),0),0);
  const accountBalance=accounts.reduce((s:number,x:any)=>s+Number(x.balance??0),0);

  return <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <header>
      <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">Financeiro</p>
      <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-extrabold"><Landmark className="h-7 w-7 text-emerald-600"/> Fluxo de caixa</h1>
      <p className="mt-1 text-sm text-muted-foreground">Realizado vem exclusivamente de Caixa/Bancos. Contas a pagar e receber em aberto entram apenas como previsão, evitando dupla contabilização.</p>
    </header>

    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Saldo das contas" value={brl(accountBalance)} tone="emerald"/>
      <Metric label="A receber (previsto)" value={brl(incomingOpen)} tone="amber"/>
      <Metric label="A pagar (previsto)" value={brl(outOpen)} tone="rose"/>
      <Metric label="Movimentos pendentes" value={String(Number(summary.pending_movements??0))} tone="slate"/>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-bold"><WalletCards className="h-4 w-4 text-emerald-600"/> Saldos por conta</h2>
        <p className="mt-1 text-sm text-slate-500">Saldo de abertura + entradas reais − saídas reais.</p>
        <div className="mt-4 divide-y">
          {accounts.map((a:any)=><div key={a.id} className="flex items-center justify-between py-3"><div><b className="text-sm">{a.name}</b><div className="text-xs text-slate-500">{a.institution||a.type}</div></div><span className="font-bold">{brl(Number(a.balance??0))}</span></div>)}
          {!q.isLoading&&!accounts.length&&<p className="py-6 text-center text-sm text-slate-500">Nenhuma conta financeira ativa.</p>}
        </div>
      </div>
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-bold">Resumo realizado</h2>
        <p className="mt-1 text-sm text-slate-500">Valores provenientes do ledger de Caixa/Bancos, sem repetir títulos liquidados.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Mini label="Entradas realizadas" value={Number(summary.cash_in??0)} positive/>
          <Mini label="Saídas realizadas" value={Number(summary.cash_out??0)}/>
          <Mini label="Saldo dos movimentos" value={Number(summary.movement_balance??0)} positive={Number(summary.movement_balance??0)>=0}/>
          <Mini label="Conciliados" value={Number(summary.matched_movements??0)} count/>
        </div>
      </div>
    </section>

    <section className="rounded-2xl border bg-white shadow-sm">
      <div className="border-b p-5">
        <h2 className="font-bold">Movimentações de Caixa/Bancos</h2>
        <p className="text-sm text-slate-500">Entradas e saídas efetivamente registradas no ledger financeiro.</p>
      </div>
      <div className="divide-y">
        {transactions.map((x:any)=><div key={x.id} className="flex items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            {x.direction==="in"?<ArrowUpRight className="h-5 w-5 shrink-0 text-emerald-600"/>:<ArrowDownRight className="h-5 w-5 shrink-0 text-rose-600"/>}
            <div className="min-w-0"><b className="block truncate text-sm">{x.description}</b><div className="text-xs text-slate-500">{date(String(x.transaction_date).slice(0,10))} · {reconLabel(x.reconciliation_status)}</div></div>
          </div>
          <span className={"shrink-0 font-bold "+(x.direction==="in"?"text-emerald-700":"text-rose-700")}>{x.direction==="in"?"+":"-"} {brl(Number(x.amount))}</span>
        </div>)}
        {!q.isLoading&&!transactions.length&&<p className="p-8 text-center text-sm text-slate-500">Sem movimentos de caixa/bancos.</p>}
      </div>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <Forecast title="Próximos recebimentos" rows={receivables} type="in"/>
      <Forecast title="Próximos pagamentos" rows={expenses} type="out"/>
    </section>
  </div>;
}

function Forecast({title,rows,type}:{title:string;rows:any[];type:"in"|"out"}){
  return <div className="rounded-2xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-bold">{title}</h2><p className="text-sm text-slate-500">Previsão; não compõe o caixa realizado até a baixa.</p></div><div className="divide-y">{rows.slice(0,20).map((x:any)=>{const settled=Number(type==="in"?x.received_amount:x.paid_amount)||0;const remaining=Math.max(Number(x.amount)-settled,0);return <div key={x.id} className="flex items-center justify-between gap-3 p-4"><div><b className="text-sm">{x.description}</b><div className="text-xs text-slate-500">Vence {date(x.due_date)}</div></div><span className={"font-bold "+(type==="in"?"text-emerald-700":"text-rose-700")}>{brl(remaining)}</span></div>})}{!rows.length&&<p className="p-6 text-center text-sm text-slate-500">Sem títulos em aberto.</p>}</div></div>;
}

function Metric({label,value,tone}:{label:string;value:string;tone:string}){
  const colors:any={amber:"border-amber-200 bg-amber-50",emerald:"border-emerald-200 bg-emerald-50",rose:"border-rose-200 bg-rose-50",slate:"border-slate-200 bg-slate-50"};
  return <div className={"rounded-2xl border p-5 "+colors[tone]}><p className="text-sm font-semibold text-slate-600">{label}</p><p className="mt-2 text-2xl font-extrabold">{value}</p></div>;
}

function Mini({label,value,positive=false,count=false}:{label:string;value:number;positive?:boolean;count?:boolean}){
  return <div className="rounded-xl border bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={"mt-1 text-lg font-extrabold "+(positive?"text-emerald-700":"text-slate-800")}>{count?value.toLocaleString("pt-BR"):brl(value)}</p></div>;
}
