import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, ClipboardList, Clock3, CreditCard, FileText, Landmark, ShoppingCart, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { brl } from "@/lib/format";
import { convertMyQuoteToPurchase, getMyQuotes } from "@/lib/my-quotes.functions";
import { requestQuoteCommercialReview } from "@/lib/quote-commercial-review.functions";

export const Route = createFileRoute("/_authenticated/orcamentos")({
  head: () => ({ meta: [{ title: "Meus orçamentos · Norte Sul" }] }),
  component: MyQuotesPage,
});

type PaymentMethod = "pix" | "cartao" | "boleto" | "faturado_b2b";
type ReviewBenefit = "conditions" | "discount" | "credit";

const statusLabel: Record<string, string> = {
  rascunho: "Disponível", enviado: "Disponível", em_negociacao: "Disponível",
  aprovado: "Disponível", convertido: "Transformado em compra",
  recusado: "Recusado", expirado: "Expirado",
};

const paymentChoices = [
  { id: "pix" as PaymentMethod, label: "PIX", Icon: Smartphone },
  { id: "cartao" as PaymentMethod, label: "Cartão", Icon: CreditCard },
  { id: "boleto" as PaymentMethod, label: "Boleto", Icon: Landmark },
];

function MyQuotesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getFn = useServerFn(getMyQuotes);
  const convertFn = useServerFn(convertMyQuoteToPurchase);
  const reviewFn = useServerFn(requestQuoteCommercialReview);

  const [payment, setPayment] = useState<Record<string, PaymentMethod>>({});
  const [reviewFormQuoteId, setReviewFormQuoteId] = useState<string | null>(null);
  const [benefit, setBenefit] = useState<ReviewBenefit>("conditions");
  const [message, setMessage] = useState("");

  const quotes = useQuery({
    queryKey: ["my-quotes"],
    queryFn: () => getFn(),
  });

  const convert = useMutation({
    mutationFn: (params: { quoteId: string; paymentMethod: PaymentMethod }) =>
      convertFn({ data: params }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      toast.success("Pedido criado. Confira os dados e conclua o pagamento.");
      navigate({ to: "/checkout", search: { pedido: result.order_id } as never });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const request = useMutation({
    mutationFn: (params: { quoteId: string; benefit: ReviewBenefit; message: string }) =>
      reviewFn({ data: params }),
    onSuccess: async () => {
      setReviewFormQuoteId(null);
      setBenefit("conditions");
      setMessage("");
      await queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      toast.success("Orçamento enviado para análise. A resposta aparecerá aqui.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = (quotes.data ?? []) as any[];

  return (
    <main className="container-x py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Área do cliente</p>
          <h1 className="mt-1 font-display text-3xl font-bold uppercase">Meus orçamentos</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Você pode comprar agora, sem aprovação, ou enviar o orçamento para análise da loja.
            O gestor poderá responder com desconto ou condições de crédito quando disponíveis.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/carrinho" className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
            Criar orçamento
          </Link>
          <Link to="/pedidos" className="rounded-md border px-4 py-2 text-sm font-bold">Meus pedidos</Link>
        </div>
      </header>

      {quotes.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando orçamentos…</p>
      ) : quotes.isError ? (
        <div role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive">
          Não foi possível carregar seus orçamentos.
        </div>
      ) : !rows.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">Você ainda não criou orçamentos.</p>
          <Link to="/carrinho" className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
            Gerar pelo carrinho
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {rows.map((quote: any) => {
            const method: PaymentMethod = payment[quote.id] ?? "pix";
            const methods = quote.approved_credit
              ? [...paymentChoices, { id: "faturado_b2b" as PaymentMethod, label: "Crédito faturado", Icon: CheckCircle2 }]
              : paymentChoices;
            const review = quote.review;
            const offer = Boolean(quote.is_commercial_offer);
            return (
              <article key={quote.id} id={"orcamento-" + quote.id} className="rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-xl font-bold">Orçamento #{quote.number}</h2>
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                        {offer ? "Proposta revisada" : statusLabel[quote.status] ?? quote.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {quote.valid_until
                        ? "Válido até " + new Date(quote.valid_until).toLocaleDateString("pt-BR")
                        : "Sem data de validade"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Total</p>
                    <p className="price-tag text-2xl">{brl(Number(quote.total ?? 0))}</p>
                    {Number(quote.discount ?? 0) > 0 && (
                      <p className="text-xs text-emerald-700">Desconto: {brl(Number(quote.discount))}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-xl border">
                  {(quote.quote_items ?? []).map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between gap-4 border-b p-3 text-sm last:border-0">
                      <div>
                        <strong>{item.name}</strong>
                        <p className="text-xs text-muted-foreground">
                          {item.qty} × {brl(Number(item.unit_price))}
                        </p>
                      </div>
                      <strong>{brl(Number(item.total ?? 0))}</strong>
                    </div>
                  ))}
                </div>

                {review && !offer && (
                  <section className="mt-4 rounded-xl border p-4 text-sm">
                    {review.status === "pending" && (
                      <p className="flex items-center gap-2 font-semibold text-amber-700">
                        <Clock3 className="h-4 w-4" /> Análise solicitada — aguardando o gestor.
                      </p>
                    )}
                    {review.status === "offered" && (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="flex items-center gap-2 font-bold text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" /> O gestor enviou uma nova proposta
                          </p>
                          <p className="mt-1">Total revisado: {brl(Number(review.offered_total ?? 0))}</p>
                          {review.manager_note && <p className="mt-1">{review.manager_note}</p>}
                        </div>
                        <a href={"#orcamento-" + review.offered_quote_id}
                          className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
                          Ver proposta da loja
                        </a>
                      </div>
                    )}
                    {review.status === "denied" && (
                      <>
                        <p className="font-bold">Condições especiais não aprovadas.</p>
                        {review.manager_note && <p className="mt-1">{review.manager_note}</p>}
                        <p className="mt-1 text-muted-foreground">Você ainda pode comprar pelos preços originais.</p>
                      </>
                    )}
                    {review.status === "converted" && !quote.order_id && (
                      <p className="font-semibold">Outra versão deste orçamento já foi comprada.</p>
                    )}
                  </section>
                )}

                {offer && review?.status === "offered" && (
                  <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <p className="font-bold">Condições comerciais liberadas pelo gestor</p>
                    <p>Desconto adicional: {brl(Number(review.additional_discount ?? 0))}.</p>
                    {quote.approved_credit && (
                      <p>Crédito faturado B2B autorizado em {review.credit_days} dias.</p>
                    )}
                    {review.manager_note && <p className="mt-1">{review.manager_note}</p>}
                    <p className="mt-1 text-xs">Estoque será confirmado somente quando você comprar.</p>
                  </section>
                )}

                {quote.order_id ? (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                    <p className="font-semibold">Pedido criado a partir deste orçamento.</p>
                    <Link to="/checkout" search={{ pedido: quote.order_id } as never}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
                      Continuar pagamento
                    </Link>
                  </div>
                ) : quote.can_buy ? (
                  <section className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <h3 className="font-bold">
                      {offer ? "Comprar com as condições aprovadas" : "Opção 1 — Transformar em compra"}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sem aprovação manual. O estoque será conferido e reservado na criação do pedido.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {methods.map(({ id, label, Icon }) => (
                        <button key={id} type="button" onClick={() => setPayment((current) => ({ ...current, [quote.id]: id }))}
                          aria-pressed={method === id}
                          className={"flex items-center gap-2 rounded-lg border p-3 text-left text-sm font-bold " +
                            (method === id ? "border-primary bg-background text-primary" : "bg-background")}>
                          <Icon className="h-4 w-4" /> {label}
                        </button>
                      ))}
                    </div>
                    <button type="button" disabled={convert.isPending}
                      onClick={() => convert.mutate({ quoteId: quote.id, paymentMethod: method })}
                      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50">
                      <ShoppingCart className="h-4 w-4" />
                      {convert.isPending ? "Validando estoque…" : "Comprar agora"}
                    </button>
                    {quote.can_request_review && (
                      <div className="mt-4 border-t pt-4">
                        <button type="button" onClick={() => setReviewFormQuoteId((id) => id === quote.id ? null : quote.id)}
                          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary px-5 text-sm font-bold text-primary">
                          <ClipboardList className="h-4 w-4" /> Opção 2 — Enviar para análise
                        </button>
                        {reviewFormQuoteId === quote.id && (
                          <div className="mt-3 grid max-w-xl gap-3 rounded-xl border bg-background p-4">
                            <p className="text-sm font-semibold">Peça ao gestor desconto ou condições de crédito.</p>
                            <label htmlFor={"benefit-" + quote.id} className="text-sm font-semibold">Sua solicitação</label>
                            <select id={"benefit-" + quote.id} value={benefit}
                              onChange={(event) => setBenefit(event.target.value as ReviewBenefit)}
                              className="min-h-10 rounded-md border bg-background px-3 text-sm">
                              <option value="conditions">Avaliar melhores condições</option>
                              <option value="discount">Solicitar desconto</option>
                              <option value="credit">Solicitar crédito / prazo</option>
                            </select>
                            <label htmlFor={"note-" + quote.id} className="text-sm font-semibold">Observações (opcional)</label>
                            <textarea id={"note-" + quote.id} maxLength={500} rows={3} value={message}
                              onChange={(event) => setMessage(event.target.value)}
                              placeholder="Ex.: gostaria de desconto para comprar esta semana."
                              className="w-full rounded-md border bg-background p-3 text-sm" />
                            <button type="button" disabled={request.isPending}
                              onClick={() => request.mutate({ quoteId: quote.id, benefit, message })}
                              className="min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50">
                              {request.isPending ? "Enviando…" : "Confirmar envio para análise"}
                            </button>
                            <p className="text-xs text-muted-foreground">
                              Enviar não cria cobrança nem reserva estoque. Você continua livre para comprar pelo preço original.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                ) : (
                  <div className="mt-4 rounded-xl border p-4 text-sm text-muted-foreground">
                    {quote.expired ? "Esta proposta venceu. Gere um novo orçamento para comprar." :
                      review?.status === "converted" ? "Uma versão deste orçamento já foi comprada." :
                      "Este orçamento não está disponível para compra."}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
