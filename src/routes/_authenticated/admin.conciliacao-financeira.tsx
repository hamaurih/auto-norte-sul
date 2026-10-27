import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  History,
  Landmark,
  Link2,
  RefreshCw,
  Scale,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getFinancialReconciliationDashboard,
  reconcileCurrentFinancialTransaction,
  runLegacyFinancialReconciliationAnalysis,
} from "@/lib/financial-reconciliation.functions";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/conciliacao-financeira")({
  head: () => ({ meta: [{ title: "Conciliação financeira · Norte Sul" }] }),
  component: ReconciliationPage,
});

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function ReconciliationPage() {
  const qc = useQueryClient();
  const get = useServerFn(getFinancialReconciliationDashboard);
  const reconcile = useServerFn(reconcileCurrentFinancialTransaction);
  const analyzeLegacy = useServerFn(runLegacyFinancialReconciliationAnalysis);

  const [scope, setScope] = useState<"current" | "legacy">("current");
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const [page, setPage] = useState(0);
  const [targets, setTargets] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["financial-reconciliation", scope, startDate, endDate, page],
    queryFn: () => get({ data: { scope, startDate, endDate, page, pageSize: 100 } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["financial-reconciliation"] });

  const match = useMutation({
    mutationFn: ({ transactionId, encodedTarget }: { transactionId: string; encodedTarget: string }) => {
      const [targetType, targetId] = encodedTarget.split(":");
      return reconcile({
        data: {
          transactionId,
          targetType: targetType as "receivable" | "payable",
          targetId,
          notes: "Conciliação manual pela Central Financeira.",
        },
      });
    },
    onSuccess: () => {
      toast.success("Movimento conciliado.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const legacyRun = useMutation({
    mutationFn: () => analyzeLegacy(),
    onSuccess: () => {
      toast.success("Análise inteligente do legado concluída. Nenhum caso foi aplicado automaticamente.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const current = q.data?.current as any;
  const legacy = q.data?.legacy as any;
  const channelSummary: any = q.data?.channelSummary ?? {};
  const channels = channelSummary.channels ?? [];
  const unverified = q.data?.unverifiedAccounts ?? [];

  const candidates = useMemo(() => {
    if (!current) return { in: [], out: [] } as Record<string, any[]>;
    return {
      in: (current.openReceivables ?? []).map((r: any) => ({
        value: `receivable:${r.id}`,
        amount: Math.max(Number(r.amount ?? 0) - Number(r.received_amount ?? 0), 0),
        label: `${r.customer_name} · ${r.description}`,
      })),
      out: (current.openPayables ?? []).map((p: any) => ({
        value: `payable:${p.id}`,
        amount: Math.max(Number(p.amount ?? 0) - Number(p.paid_amount ?? 0), 0),
        label: `${p.supplier_name || "Fornecedor"} · ${p.description}`,
      })),
    };
  }, [current]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">Financeiro omnichannel</p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-extrabold">
            <Scale className="h-7 w-7 text-emerald-600" /> Conciliação e fechamento
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Operação atual desde 21/10/2026 separada do histórico Bling. O legado permanece auditável e não contamina caixa nem DRE novos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/fluxo-caixa" className="rounded-xl border bg-white px-4 py-2.5 text-sm font-bold">Fluxo de caixa</Link>
          <Link to="/admin/financeiro-canais" className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">DRE por canal</Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-3">
        <button type="button" onClick={() => { setScope("current"); setPage(0); }} className={`rounded-xl px-4 py-2 text-sm font-bold ${scope === "current" ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`}>Operação atual</button>
        <button type="button" onClick={() => { setScope("legacy"); setPage(0); }} className={`rounded-xl px-4 py-2 text-sm font-bold ${scope === "legacy" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Histórico Bling</button>
        <div className="ml-auto flex gap-2">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" />
          <button onClick={() => void q.refetch()} className="rounded-lg border p-2"><RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /></button>
        </div>
      </div>

      {scope === "current" ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={BadgeCheck} label="Conciliação atual" value={current?.transactionCounts?.pending ?? 0} suffix=" pendente(s)" good={(current?.transactionCounts?.pending ?? 0) === 0} />
            <Metric icon={WalletCards} label="A receber" value={current?.openReceivablesTotal ?? 0} money />
            <Metric icon={ArrowDownRight} label="A pagar aprovado" value={current?.openPayablesTotal ?? 0} money />
            <Metric icon={Landmark} label="Saldos não homologados" value={unverified.length} suffix=" conta(s)" good={unverified.length === 0} />
          </section>

          <section className={`rounded-2xl border p-4 ${current?.cashCloseReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-start gap-3">
              {current?.cashCloseReady ? <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />}
              <div>
                <b>{current?.cashCloseReady ? "Ledger atual conciliado e saldos de abertura homologados." : current?.reconciliationReady ? "Ledger atual conciliado; falta homologar saldos de abertura." : "Há movimentos atuais pendentes de conciliação."}</b>
                <p className="mt-1 text-sm">O DRE por competência continua disponível. O saldo bancário definitivo depende dos saldos reais das contas operacionais.</p>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="font-black">Pendências de conciliação da operação atual</h2>
              <p className="text-sm text-slate-500">Movimentos gerados pelo Order Core normalmente já entram conciliados. Esta fila recebe exceções e extratos atuais importados.</p>
            </div>
            <div className="divide-y">
              {(current?.pendingTransactions ?? []).map((tx: any) => {
                const list = tx.direction === "in" ? candidates.in : candidates.out;
                const sorted = [...list].sort((a, b) => Math.abs(a.amount - Number(tx.amount)) - Math.abs(b.amount - Number(tx.amount))).slice(0, 30);
                return (
                  <div key={tx.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_160px_minmax(260px,1fr)_auto] lg:items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        {tx.direction === "in" ? <ArrowUpRight className="h-4 w-4 text-emerald-600" /> : <ArrowDownRight className="h-4 w-4 text-rose-600" />}
                        <b>{tx.description}</b>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{String(tx.transaction_date).slice(0, 10)} · {tx.sales_channel?.name ?? "Sem canal"} · {tx.account?.name ?? "Conta"}</p>
                    </div>
                    <div className="font-black">{brl(Number(tx.amount))}</div>
                    <select value={targets[tx.id] ?? ""} onChange={(e) => setTargets((old) => ({ ...old, [tx.id]: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm">
                      <option value="">Selecionar título compatível</option>
                      {sorted.map((target) => <option key={target.value} value={target.value}>{target.label} · {brl(target.amount)}</option>)}
                    </select>
                    <button disabled={!targets[tx.id] || match.isPending} onClick={() => match.mutate({ transactionId: tx.id, encodedTarget: targets[tx.id] })} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"><Link2 className="h-4 w-4" />Conciliar</button>
                  </div>
                );
              })}
              {!q.isLoading && (current?.pendingTransactions ?? []).length === 0 && (
                <div className="p-10 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
                  <p className="mt-3 font-bold">Nenhuma pendência operacional de conciliação.</p>
                  <p className="mt-1 text-sm text-slate-500">Movimentos atuais estão vinculados aos respectivos títulos.</p>
                </div>
              )}
            </div>
          </section>

          <ChannelClose channels={channels} />
        </>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-300 bg-slate-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2"><History className="h-5 w-5" /><h2 className="font-black">Legado Bling — auditoria histórica</h2></div>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">Esses movimentos não entram no caixa operacional pós-21/10. A análise inteligente apenas cria sugestões; não aplica automaticamente nesta tela.</p>
              </div>
              <button disabled={legacyRun.isPending} onClick={() => legacyRun.mutate()} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {legacyRun.isPending ? "Analisando…" : "Executar análise inteligente"}
              </button>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={AlertTriangle} label="Pendentes históricos" value={legacy?.summary?.transactions?.pending ?? 0} suffix=" movimento(s)" />
            <Metric icon={BadgeCheck} label="Conciliados históricos" value={legacy?.summary?.transactions?.matched ?? 0} suffix=" movimento(s)" good />
            <Metric icon={Scale} label="Sem relação determinística" value={legacy?.summary?.unresolved ?? 0} suffix=" movimento(s)" />
            <Metric icon={History} label="Casos inteligentes" value={(legacy?.summary?.cases ?? []).reduce((s: number, x: any) => s + Number(x.count ?? 0), 0)} suffix=" caso(s)" />
          </section>

          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b p-5"><h2 className="font-black">Fila histórica não resolvida</h2><p className="text-sm text-slate-500">Mantida separada porque não existe evidência determinística suficiente para baixar títulos automaticamente.</p></div>
            <div className="divide-y">
              {(legacy?.queue?.rows ?? []).map((row: any) => (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div><b>{row.description}</b><p className="mt-1 text-xs text-slate-500">{row.transaction_date} · {row.party || "Sem favorecido"} · {row.reason}</p></div>
                  <span className={`font-bold ${row.direction === "in" ? "text-emerald-700" : "text-rose-700"}`}>{row.direction === "in" ? "+" : "-"} {brl(Number(row.amount))}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ChannelClose({ channels }: { channels: any[] }) {
  return <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-black">Fechamento por canal</h2><p className="text-sm text-slate-500">Receita, margem, caixa e pendências usando apenas a operação omnichannel atual.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-4">Canal</th><th>Receita</th><th>Margem</th><th>Caixa líquido</th><th>A receber</th><th>Conciliação</th></tr></thead><tbody>{channels.map((row) => <tr key={row.code} className="border-t"><td className="p-4 font-bold">{row.name}</td><td>{brl(Number(row.revenue ?? 0))}</td><td className={Number(row.contribution_margin ?? 0) >= 0 ? "font-bold text-emerald-700" : "font-bold text-rose-700"}>{brl(Number(row.contribution_margin ?? 0))}</td><td>{brl(Number(row.net_cash ?? 0))}</td><td>{brl(Number(row.open_receivables ?? 0))}</td><td>{Number(row.pending_reconciliation ?? 0) === 0 ? <span className="font-bold text-emerald-700">Conciliado</span> : <span className="font-bold text-amber-700">{row.pending_reconciliation} pendente(s)</span>}</td></tr>)}</tbody></table></div></section>;
}

function Metric({ icon: Icon, label, value, money = false, suffix = "", good = false }: { icon: typeof Scale; label: string; value: number; money?: boolean; suffix?: string; good?: boolean }) {
  return <article className={`rounded-2xl border bg-white p-5 shadow-sm ${good ? "border-emerald-200" : ""}`}><Icon className={`h-5 w-5 ${good ? "text-emerald-600" : "text-blue-600"}`} /><p className="mt-4 text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{money ? brl(Number(value)) : Number(value).toLocaleString("pt-BR") + suffix}</p></article>;
}
