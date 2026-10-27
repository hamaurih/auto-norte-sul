import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  BarChart3,
  Landmark,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { getChannelFinanceSummary } from "@/lib/financial.functions";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/financeiro-canais")({
  head: () => ({ meta: [{ title: "DRE e fechamento por canal · Norte Sul" }] }),
  component: ChannelFinance,
});

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

const tone: Record<string, string> = {
  site: "bg-blue-50 text-blue-700",
  pdv: "bg-emerald-50 text-emerald-700",
  whatsapp: "bg-violet-50 text-violet-700",
  vendedor: "bg-fuchsia-50 text-fuchsia-700",
};

function ChannelFinance() {
  const get = useServerFn(getChannelFinanceSummary);
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const q = useQuery({
    queryKey: ["finance-by-channel", startDate, endDate],
    queryFn: () => get({ data: { startDate, endDate } }),
  });

  const summary: any = q.data?.summary ?? {};
  const channels: any[] = summary.channels ?? [];
  const accounts: any[] = q.data?.accounts ?? [];

  const totals = useMemo(() => channels.reduce((acc, row) => {
    acc.revenue += Number(row.revenue ?? 0);
    acc.cogs += Number(row.cogs ?? 0);
    acc.channelCost += Number(row.channel_cost ?? 0);
    acc.directExpenses += Number(row.direct_expenses ?? 0);
    acc.margin += Number(row.contribution_margin ?? 0);
    acc.cashIn += Number(row.cash_in ?? 0);
    acc.cashOut += Number(row.cash_out ?? 0);
    acc.open += Number(row.open_receivables ?? 0);
    return acc;
  }, { revenue: 0, cogs: 0, channelCost: 0, directExpenses: 0, margin: 0, cashIn: 0, cashOut: 0, open: 0 }), [channels]);

  const unverified = accounts.filter((a) => !a.opening_balance_verified_at && !String(a.system_code ?? "").startsWith("clearing:"));

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">Financeiro omnichannel</p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-extrabold">
            <BarChart3 className="h-7 w-7 text-emerald-600" /> DRE e fechamento por canal
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Receita reconhecida, CMV, custos do canal, despesas diretas, recebido e a receber. Histórico Bling anterior a 21/10/2026 fica fora desta visão.
          </p>
        </div>
        <div className="flex gap-2 rounded-2xl border bg-white p-2">
          <label className="text-xs font-bold text-slate-500">De<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="ml-2 rounded-lg border px-2 py-1.5 text-sm text-slate-900" /></label>
          <label className="text-xs font-bold text-slate-500">Até<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="ml-2 rounded-lg border px-2 py-1.5 text-sm text-slate-900" /></label>
        </div>
      </header>

      {Number(summary.unverified_opening_accounts ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <b>{summary.unverified_opening_accounts} conta(s) com saldo inicial ainda não homologado.</b>
              <p className="text-sm">O DRE por competência é válido; o saldo bancário consolidado só será definitivo após a homologação dos saldos de abertura.</p>
            </div>
          </div>
          <Link to="/admin/financeiro" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold">Homologar saldos</Link>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={BadgeDollarSign} label="Receita reconhecida" value={totals.revenue} />
        <Metric icon={Landmark} label="CMV" value={totals.cogs} negative />
        <Metric icon={WalletCards} label="Margem de contribuição" value={totals.margin} positive={totals.margin >= 0} />
        <Metric icon={ArrowUpRight} label="Caixa recebido" value={totals.cashIn} positive />
      </section>

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-black">DRE gerencial por canal</h2>
          <p className="text-sm text-slate-500">CMV usa o custo congelado no item da venda. Custos de canal usam o snapshot da venda. Despesas diretas vêm de Contas a Pagar.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-4">Canal</th>
                <th>Pedidos</th>
                <th>Receita</th>
                <th>CMV</th>
                <th>Custo canal</th>
                <th>Despesa direta</th>
                <th>Margem contribuição</th>
                <th>A receber</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((row) => (
                <tr key={row.code} className="border-t">
                  <td className="p-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone[row.code] ?? "bg-slate-100"}`}>{row.name}</span></td>
                  <td>{Number(row.orders ?? 0)}</td>
                  <td className="font-semibold">{brl(Number(row.revenue ?? 0))}</td>
                  <td className="text-rose-700">{brl(Number(row.cogs ?? 0))}</td>
                  <td className="text-rose-700">{brl(Number(row.channel_cost ?? 0))}</td>
                  <td className="text-rose-700">{brl(Number(row.direct_expenses ?? 0))}</td>
                  <td className={Number(row.contribution_margin ?? 0) >= 0 ? "font-bold text-emerald-700" : "font-bold text-rose-700"}>{brl(Number(row.contribution_margin ?? 0))}</td>
                  <td className="text-amber-700">{brl(Number(row.open_receivables ?? 0))}</td>
                </tr>
              ))}
              {!q.isLoading && channels.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-500">Sem dados para o período.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-black">Fechamento de caixa por canal</h2>
          <p className="mt-1 text-sm text-slate-500">Entradas e saídas do ledger pós-virada. Clearing de operadora não é saldo bancário.</p>
          <div className="mt-4 divide-y">
            {channels.map((row) => (
              <div key={row.code} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 py-3 text-sm">
                <span className="font-bold">{row.name}</span>
                <span className="text-emerald-700">+ {brl(Number(row.cash_in ?? 0))}</span>
                <span className="text-rose-700">- {brl(Number(row.cash_out ?? 0))}</span>
                <span className="font-black">{brl(Number(row.net_cash ?? 0))}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-black">Despesas corporativas não rateadas</h2>
          <p className="mt-1 text-sm text-slate-500">Não são distribuídas artificialmente entre canais; aparecem separadas até existir critério de rateio aprovado.</p>
          <p className="mt-6 text-3xl font-black text-slate-900">{brl(Number(summary.unallocated_expenses ?? 0))}</p>
          <p className="mt-4 text-xs text-slate-500">Ex.: aluguel, contabilidade, despesas administrativas compartilhadas.</p>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-black">Contas operacionais</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {accounts.filter((a) => a.name !== "Bling — Caixa/Bancos (histórico)").map((a) => (
            <div key={a.id} className="rounded-xl border bg-slate-50 p-4">
              <p className="font-bold">{a.name}</p>
              <p className="mt-1 text-xs text-slate-500">{a.institution_name ?? a.account_type}</p>
              <p className="mt-3 text-sm">Abertura: <b>{brl(Number(a.opening_balance ?? 0))}</b></p>
              <p className={`mt-1 text-xs font-bold ${a.opening_balance_verified_at ? "text-emerald-700" : String(a.system_code ?? "").startsWith("clearing:") ? "text-blue-700" : "text-amber-700"}`}>
                {a.opening_balance_verified_at ? "Saldo inicial homologado" : String(a.system_code ?? "").startsWith("clearing:") ? "Clearing iniciado em zero" : "Saldo inicial não verificado"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value, positive = false, negative = false }: { icon: typeof BarChart3; label: string; value: number; positive?: boolean; negative?: boolean }) {
  return <article className="rounded-2xl border bg-white p-5 shadow-sm"><Icon className={`h-5 w-5 ${positive ? "text-emerald-600" : negative ? "text-rose-600" : "text-blue-600"}`} /><p className="mt-4 text-xs font-bold uppercase text-slate-500">{label}</p><p className={`mt-1 text-2xl font-black ${positive ? "text-emerald-700" : negative ? "text-rose-700" : ""}`}>{brl(value)}</p></article>;
}
