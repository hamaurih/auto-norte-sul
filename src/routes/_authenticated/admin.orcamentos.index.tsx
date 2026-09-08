import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  PlusCircle,
  Search,
  ExternalLink,
  Copy,
  CheckCircle2,
  XCircle,
  Handshake,
  FileCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { brl } from "@/lib/format";
import {
  createQuoteRevision,
  generateProposal,
  getQuoteDashboard,
  listQuotes,
  transitionQuote,
} from "@/lib/quotes.functions";
import { formatDate, formatDateTime, isOverdue, originLabel, statusLabel, statusTone, QUOTE_ORIGIN_LABEL } from "@/lib/quotes-ui";

export const Route = createFileRoute("/_authenticated/admin/orcamentos/")({
  head: () => ({
    meta: [
      { title: "Orçamentos e propostas · Norte Sul" },
      { name: "description", content: "Painel comercial de orçamentos, propostas e fechamento de vendas." },
    ],
  }),
  component: OrcamentosPage,
});

const BUCKETS = [
  { key: "todos", label: "Todos" },
  { key: "rascunhos", label: "Rascunhos" },
  { key: "enviados", label: "Enviados" },
  { key: "negociacao", label: "Negociação" },
  { key: "aprovados", label: "Aprovados" },
  { key: "fechados", label: "Fechados" },
  { key: "perdidos", label: "Perdidos" },
] as const;

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function OrcamentosPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listQuotes);
  const dashboardFn = useServerFn(getQuoteDashboard);
  const transitionFn = useServerFn(transitionQuote);
  const proposalFn = useServerFn(generateProposal);
  const revisionFn = useServerFn(createQuoteRevision);

  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]["key"]>("todos");
  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState("");

  const { data: kpis } = useQuery({ queryKey: ["quote-kpis"], queryFn: () => dashboardFn({} as any) });
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["quotes", bucket, search, origin],
    queryFn: () =>
      listFn({
        data: {
          bucket,
          search: search.trim() || undefined,
          origin: (origin || undefined) as any,
        },
      }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quotes"] });
    qc.invalidateQueries({ queryKey: ["quote-kpis"] });
  };

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast.success(message);
      refresh();
    } catch (err) {
      toast.error((err as Error).message || "Não foi possível concluir a ação.");
    }
  };

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header className="admin-page-hero flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-blue-700">Comercial</p>
          <h1 className="mt-1 font-display text-3xl font-bold">Orçamentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Criar → negociar → proposta → aprovar → fechar em pedido. Pagamento acontece depois do pedido.
          </p>
        </div>
        <Button asChild size="lg">
          <Link to="/admin/orcamentos/novo">
            <PlusCircle className="mr-2 h-4 w-4" /> Novo orçamento
          </Link>
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Em aberto" value={String(kpis?.open ?? 0)} />
        <Kpi label="Em negociação" value={String(kpis?.negotiating ?? 0)} />
        <Kpi label="Aprovados" value={String(kpis?.approved ?? 0)} />
        <Kpi label="Pipeline" value={brl(kpis?.pipeline ?? 0)} hint="Valor em aberto" />
        <Kpi label="Conversão" value={`${kpis?.conversionRate ?? 0}%`} hint="Fechados / decididos" />
        <Kpi
          label="Vencendo em 7 dias"
          value={String(kpis?.expiringIn7 ?? 0)}
          hint={kpis?.lateFollowUps ? `${kpis.lateFollowUps} acompanhamento(s) atrasado(s)` : undefined}
        />
      </div>

      <div className="admin-filter-bar flex flex-wrap items-center gap-2">
        {BUCKETS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setBucket(item.key)}
            className={`min-h-9 rounded-md border px-3 text-xs font-semibold uppercase transition-colors ${
              bucket === item.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por número, cliente, telefone ou e-mail"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          className="h-10 rounded-md border border-border bg-background px-2 text-sm"
          aria-label="Filtrar por origem"
        >
          <option value="">Todas as origens</option>
          {Object.entries(QUOTE_ORIGIN_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {isError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
          {(error as Error)?.message ?? "Não foi possível carregar os orçamentos."}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-display text-lg font-bold">Nenhum orçamento neste filtro</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Comece registrando a negociação e transforme em proposta quando estiver pronta.
            </p>
            <Button asChild className="mt-4">
              <Link to="/admin/orcamentos/novo">
                <PlusCircle className="mr-2 h-4 w-4" /> Criar primeiro orçamento
              </Link>
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Nº</th>
                  <th className="p-3 text-left">Cliente</th>
                  <th className="p-3 text-left">Vendedor</th>
                  <th className="p-3 text-left">Origem</th>
                  <th className="p-3 text-left">Etapa</th>
                  <th className="p-3 text-left">Validade</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-left">Atualizado</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((quote: any) => (
                  <tr key={quote.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="p-3 font-mono">
                      <Link to="/admin/orcamentos/$id" params={{ id: quote.id }} className="font-bold hover:underline">
                        #{quote.number}
                      </Link>
                      {Number(quote.version ?? 1) > 1 && (
                        <span className="ml-1 text-[10px] text-muted-foreground">v{quote.version}</span>
                      )}
                      {quote.document_type === "proposta" && (
                        <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] font-bold text-blue-700">proposta</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Link to="/admin/orcamentos/$id" params={{ id: quote.id }} className="font-semibold hover:underline">
                        {quote.customer_name || "Cliente não informado"}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[quote.customer_phone, quote.customer_email].filter(Boolean).join(" · ")}
                      </div>
                      {isOverdue(quote.follow_up_at) && !["convertido", "recusado"].includes(quote.status) && (
                        <span className="mt-1 inline-flex rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">
                          acompanhamento atrasado
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs">{quote.sales_rep_name ?? "—"}</td>
                    <td className="p-3 text-xs">{originLabel(quote.origin)}</td>
                    <td className="p-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ${statusTone(quote.status)}`}>
                        {statusLabel(quote.status)}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{formatDate(quote.valid_until)}</td>
                    <td className="p-3 text-right font-bold">{brl(Number(quote.total ?? 0))}</td>
                    <td className="p-3 text-xs">{formatDateTime(quote.updated_at)}</td>
                    <td className="p-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline">Ações</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate({ to: "/admin/orcamentos/$id", params: { id: quote.id } })}>
                            <ExternalLink className="mr-2 h-4 w-4" /> Abrir
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              runAction(async () => {
                                const result = await revisionFn({ data: { id: quote.id } });
                                navigate({ to: "/admin/orcamentos/$id", params: { id: result.id } });
                              }, "Revisão criada.")
                            }
                          >
                            <Copy className="mr-2 h-4 w-4" /> Criar revisão
                          </DropdownMenuItem>
                          {quote.document_type !== "proposta" && quote.status !== "convertido" && (
                            <DropdownMenuItem
                              onClick={() => runAction(() => proposalFn({ data: { id: quote.id } }), "Proposta gerada.")}
                            >
                              <FileCheck2 className="mr-2 h-4 w-4" /> Gerar proposta
                            </DropdownMenuItem>
                          )}
                          {!["convertido", "recusado"].includes(quote.status) && (
                            <>
                              <DropdownMenuItem
                                onClick={() =>
                                  runAction(
                                    () => transitionFn({ data: { id: quote.id, status: "em_negociacao" } }),
                                    "Marcado como em negociação.",
                                  )
                                }
                              >
                                <Handshake className="mr-2 h-4 w-4" /> Marcar negociação
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  runAction(
                                    () => transitionFn({ data: { id: quote.id, status: "aprovado" } }),
                                    "Orçamento aprovado.",
                                  )
                                }
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" /> Aprovar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  const reason = window.prompt("Motivo da perda:");
                                  if (!reason?.trim()) return;
                                  runAction(
                                    () =>
                                      transitionFn({
                                        data: { id: quote.id, status: "recusado", lost_reason: reason.trim() },
                                      }),
                                    "Orçamento marcado como perdido.",
                                  );
                                }}
                              >
                                <XCircle className="mr-2 h-4 w-4" /> Registrar perda
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Orçamentos e propostas são documentos comerciais. Nenhuma cobrança é gerada nesta etapa.
      </p>
    </div>
  );
}
