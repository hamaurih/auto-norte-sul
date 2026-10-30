import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, Clock3, FileCheck2, FileText, Landmark, XCircle } from "lucide-react";
import { toast } from "sonner";
import { brl } from "@/lib/format";
import { decideQuoteCommercialReview, listQuoteCommercialReviews } from "@/lib/quote-commercial-review.functions";

export const Route = createFileRoute("/_authenticated/admin/orcamentos/analises")({
  head: () => ({
    meta: [{ title: "Análise de orçamentos · ERP Norte Sul" }],
  }),
  component: CommercialReviewPage,
});

const benefitLabels: Record<string, string> = {
  conditions: "Melhores condições",
  discount: "Desconto",
  credit: "Crédito / prazo",
};
const statusLabels: Record<string, string> = {
  pending: "Aguardando análise",
  offered: "Proposta enviada",
  denied: "Condição não concedida",
  converted: "Venda realizada",
};

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function ReviewEditor({ review, onDone }: { review: any; onDone: () => void }) {
  const decideFn = useServerFn(decideQuoteCommercialReview);
  const [discountText, setDiscountText] = useState("0");
  const [creditMode, setCreditMode] = useState<"none" | "invoice">("none");
  const [note, setNote] = useState("");
  const [confirmDeny, setConfirmDeny] = useState(false);
  const [working, setWorking] = useState(false);

  const quote = review.quote;
  const original = Number(quote?.total ?? review.original_total ?? 0);
  const discount = Number(discountText);
  const newTotal = original - (Number.isFinite(discount) ? discount : 0);

  async function save(decision: "offer" | "deny") {
    if (working) return;
    if (decision === "offer" && (!Number.isFinite(discount) || discount < 0 ||
      Math.round(discount * 100) / 100 !== discount || newTotal < 5)) {
      toast.error("Revise o desconto. O valor final deve ser de pelo menos R$ 5,00.");
      return;
    }
    if (decision === "deny" && note.trim().length < 3) {
      toast.error("Informe o motivo de não conceder condições especiais.");
      return;
    }
    if (decision === "offer" && creditMode === "invoice" && !review.creditEligible) {
      toast.error("O cliente não possui faturamento B2B habilitado.");
      return;
    }

    setWorking(true);
    try {
      const result = await decideFn({ data: {
        reviewId: review.id,
        decision,
        additionalDiscount: decision === "offer" ? discount : 0,
        creditMode: decision === "offer" ? creditMode : "none",
        managerNote: note.trim(),
      } });
      toast.success(decision === "offer"
        ? "Nova proposta #" + result.offer_number + " disponível para o cliente."
        : "Análise respondida. O cliente poderá comprar pelo valor original.");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao registrar análise.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 rounded-xl border bg-background p-4">
      <div>
        <h3 className="font-bold">Itens e valores originais</h3>
        <div className="mt-2 overflow-hidden rounded-lg border">
          {(quote?.quote_items ?? []).map((item: any) => (
            <div key={item.id} className="flex justify-between gap-4 border-b p-3 text-sm last:border-0">
              <div><strong>{item.name}</strong><p className="text-xs text-muted-foreground">{item.qty} unidade(s)</p></div>
              <span className="font-semibold">{brl(Number(item.total ?? 0))}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Orçamento original</p>
          <strong className="text-xl">{brl(original)}</strong>
        </div>
        <label className="rounded-lg border p-3">
          <span className="text-xs font-semibold">Desconto adicional (R$)</span>
          <input className="mt-1 w-full rounded border bg-background px-2 py-1 text-lg font-bold"
            type="number" min={0} max={Math.max(original - 5, 0)} step="0.01"
            value={discountText} onChange={(event) => setDiscountText(event.target.value)} />
        </label>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Valor proposto</p>
          <strong className="text-xl text-primary">{brl(newTotal)}</strong>
        </div>
      </div>

      <div>
        <label htmlFor={"credit-" + review.id} className="text-sm font-semibold">Condição de pagamento</label>
        <select id={"credit-" + review.id} value={creditMode}
          onChange={(event) => setCreditMode(event.target.value as "none" | "invoice")}
          className="mt-2 w-full rounded-md border bg-background p-3 text-sm">
          <option value="none">PIX / cartão / boleto conforme cadastro</option>
          {review.creditEligible && (
            <option value="invoice">Crédito faturado B2B em {review.allowedCreditDays} dias</option>
          )}
        </select>
        {!review.creditEligible && (
          <p className="mt-2 text-xs text-muted-foreground">
            Crédito não habilitado para este cadastro. Antes de oferecê-lo, verifique aprovação B2B
            e condições de faturamento na central de cadastros. O desconto pode ser aprovado normalmente.
            {" "}<Link className="text-primary underline" to="/admin/cadastros-b2b">Cadastros B2B</Link>
          </p>
        )}
      </div>

      <label className="block text-sm font-semibold" htmlFor={"note-" + review.id}>Resposta ao cliente</label>
      <textarea id={"note-" + review.id} rows={3} maxLength={1000}
        className="w-full rounded-lg border bg-background p-3 text-sm"
        placeholder="Explique as condições oferecidas ou o motivo da recusa."
        value={note} onChange={(event) => setNote(event.target.value)} />

      <p className="text-xs text-muted-foreground">
        A proposta cria uma nova versão do orçamento com validade de até 48 horas, sem alterar o
        documento original. Não reserva estoque, não cria cobrança e não autoriza crédito fora da política B2B.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={working} onClick={() => void save("offer")}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50">
          <FileCheck2 className="h-4 w-4" />
          {working ? "Registrando…" : "Aprovar e enviar proposta ao cliente"}
        </button>
        {confirmDeny ? (
          <button type="button" disabled={working} onClick={() => void save("deny")}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-destructive px-5 text-sm font-bold text-destructive disabled:opacity-50">
            <XCircle className="h-4 w-4" /> Confirmar recusa
          </button>
        ) : (
          <button type="button" disabled={working} onClick={() => setConfirmDeny(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-5 text-sm font-bold">
            <XCircle className="h-4 w-4" /> Não conceder condições especiais
          </button>
        )}
      </div>
    </div>
  );
}

function CommercialReviewPage() {
  const getFn = useServerFn(listQuoteCommercialReviews);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "history">("pending");
  const reviews = useQuery({
    queryKey: ["quote-commercial-reviews"],
    queryFn: () => getFn(),
  });
  const rows = (reviews.data ?? []) as any[];
  const pending = rows.filter((review) => review.status === "pending");
  const filtered = filter === "pending" ? pending : rows.filter((review) => review.status !== "pending");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["quote-commercial-reviews"] });
    void queryClient.invalidateQueries({ queryKey: ["quotes"] });
    void queryClient.invalidateQueries({ queryKey: ["quote-kpis"] });
  };

  return (
    <main className="space-y-6">
      <header className="admin-page-hero">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-primary">Comercial · ERP</p>
        <h1 className="mt-1 font-display text-3xl font-bold">Análise comercial de orçamentos</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Solicitações enviadas pelo cliente. Aprove novas condições, ofereça desconto ou crédito elegível,
          ou informe o motivo de não conceder condições especiais.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-bold">
            <Clock3 className="h-4 w-4" /> {pending.length} aguardando análise
          </span>
          <Link to="/admin/orcamentos" className="rounded-lg border px-4 py-2 text-sm font-semibold">
            Todos os orçamentos
          </Link>
        </div>
      </header>

      <div className="flex gap-2">
        <button type="button" onClick={() => setFilter("pending")}
          className={"rounded-lg border px-4 py-2 text-sm font-bold " +
            (filter === "pending" ? "border-primary bg-primary/10 text-primary" : "")}>
          Pendentes ({pending.length})
        </button>
        <button type="button" onClick={() => setFilter("history")}
          className={"rounded-lg border px-4 py-2 text-sm font-bold " +
            (filter === "history" ? "border-primary bg-primary/10 text-primary" : "")}>
          Respondidos
        </button>
      </div>

      {reviews.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando solicitações…</p>
      ) : reviews.isError ? (
        <div role="alert" className="rounded-lg border border-destructive p-4 text-destructive">
          {(reviews.error as Error)?.message ?? "Não foi possível consultar a fila."}
        </div>
      ) : !filtered.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <ClipboardListIcon />
          <p className="mt-2 font-semibold">
            {filter === "pending" ? "Nenhuma análise pendente." : "Ainda não existem análises respondidas."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((review) => (
            <article key={review.id} className="rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl font-bold">
                      Orçamento #{review.quote?.number ?? "—"}
                    </h2>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
                      {statusLabels[review.status] ?? review.status}
                    </span>
                  </div>
                  <p className="mt-1 font-semibold">{review.quote?.customer_name ?? "Cliente"}</p>
                  <p className="text-xs text-muted-foreground">
                    {[review.quote?.customer_email, review.quote?.customer_phone].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Solicitado em {dateTime(review.requested_at)} · {benefitLabels[review.requested_benefit]}
                  </p>
                  {review.customer_message && (
                    <p className="mt-2 rounded-lg bg-muted/50 p-3 text-sm">"{review.customer_message}"</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total original</p>
                  <p className="price-tag text-2xl">{brl(Number(review.original_total))}</p>
                  <Link to="/admin/orcamentos/$id" params={{ id: review.quote_id }}
                    className="mt-2 inline-block text-xs font-semibold text-primary underline">
                    Abrir orçamento completo
                  </Link>
                </div>
              </div>

              {review.status === "pending" ? (
                <ReviewEditor key={review.id} review={review} onDone={refresh} />
              ) : (
                <div className="mt-4 rounded-xl border p-4 text-sm">
                  <div className="flex items-center gap-2 font-bold">
                    {review.status === "offered" ? <CheckCircle2 className="h-4 w-4" /> :
                      review.status === "denied" ? <XCircle className="h-4 w-4" /> :
                      <Landmark className="h-4 w-4" />}
                    {statusLabels[review.status]}
                  </div>
                  {review.offered_total != null && <p>Valor proposto: {brl(Number(review.offered_total))}</p>}
                  {review.credit_mode === "invoice" && <p>Crédito B2B: {review.credit_days} dias</p>}
                  {review.manager_note && <p className="mt-2">{review.manager_note}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">Respondido em {dateTime(review.reviewed_at)}</p>
                  {review.offered_quote_id && (
                    <Link to="/admin/orcamentos/$id" params={{ id: review.offered_quote_id }}
                      className="mt-2 inline-block font-semibold text-primary underline">
                      Abrir proposta revisada
                    </Link>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function ClipboardListIcon() {
  return <FileText className="mx-auto h-8 w-8 text-muted-foreground" />;
}
