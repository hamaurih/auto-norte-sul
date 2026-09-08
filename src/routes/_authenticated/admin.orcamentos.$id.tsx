import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCopy,
  Copy,
  FileCheck2,
  Handshake,
  Printer,
  ShoppingCart,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QuoteForm } from "@/components/admin/QuoteForm";
import { brl } from "@/lib/format";
import {
  convertQuoteToSalesOrder,
  createQuoteRevision,
  generateProposal,
  getQuote,
  transitionQuote,
} from "@/lib/quotes.functions";
import { eventLabel, formatDate, formatDateTime, originLabel, statusLabel, statusTone } from "@/lib/quotes-ui";

export const Route = createFileRoute("/_authenticated/admin/orcamentos/$id")({
  head: () => ({
    meta: [
      { title: "Orçamento · Norte Sul" },
      { name: "description", content: "Detalhe do orçamento, proposta comercial, histórico e fechamento." },
    ],
  }),
  component: OrcamentoDetailPage,
});

function OrcamentoDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getFn = useServerFn(getQuote);
  const transitionFn = useServerFn(transitionQuote);
  const proposalFn = useServerFn(generateProposal);
  const revisionFn = useServerFn(createQuoteRevision);
  const convertFn = useServerFn(convertQuoteToSalesOrder);

  const [confirmClose, setConfirmClose] = useState(false);
  const [working, setWorking] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["quote", id],
    queryFn: () => getFn({ data: { id } }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quote", id] });
    qc.invalidateQueries({ queryKey: ["quotes"] });
    qc.invalidateQueries({ queryKey: ["quote-kpis"] });
  };

  const run = async (action: () => Promise<unknown>, message: string) => {
    setWorking(true);
    try {
      await action();
      toast.success(message);
      refresh();
    } catch (err) {
      toast.error((err as Error).message || "Não foi possível concluir a ação.");
    } finally {
      setWorking(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
        {(error as Error)?.message ?? "Orçamento não encontrado."}
      </div>
    );
  }

  const quote = data.quote as any;
  const items = (quote.items ?? []) as any[];
  const converted = quote.status === "convertido";
  const isProposal = quote.document_type === "proposta";
  const proposalLocked =
    isProposal &&
    (quote.sent_at || ["enviado", "em_negociacao", "aprovado", "recusado"].includes(quote.status));


  const summaryText = [
    `Norte Sul Auto Peças`,
    `${isProposal ? "Proposta" : "Orçamento"} #${quote.number}${Number(quote.version ?? 1) > 1 ? ` (v${quote.version})` : ""}`,
    quote.customer_name ? `Cliente: ${quote.customer_name}` : "",
    "",
    ...items.map(
      (item) => `${item.qty}x ${item.name} — ${brl(Number(item.unit_price))} = ${brl(Number(item.total ?? 0))}`,
    ),
    "",
    `Subtotal: ${brl(Number(quote.subtotal ?? 0))}`,
    Number(quote.discount ?? 0) > 0 ? `Desconto: -${brl(Number(quote.discount))}` : "",
    Number(quote.shipping_amount ?? 0) > 0 ? `Frete: ${brl(Number(quote.shipping_amount))}` : "",
    `Total: ${brl(Number(quote.total ?? 0))}`,
    quote.payment_terms ? `Pagamento: ${quote.payment_terms}` : "",
    quote.delivery_terms ? `Entrega: ${quote.delivery_terms}` : "",
    quote.valid_until ? `Validade: ${formatDate(quote.valid_until)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      toast.success("Resumo copiado. Cole no WhatsApp ou e-mail.");
    } catch {
      toast.error("Não foi possível copiar o resumo.");
    }
  };

  return (
    <div className="space-y-6">
      <header className="admin-page-hero flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/orcamentos">
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Link>
          </Button>
          <h1 className="mt-2 font-display text-2xl font-bold">
            {isProposal ? "Proposta" : "Orçamento"} #{quote.number}
            {Number(quote.version ?? 1) > 1 && (
              <span className="ml-2 text-sm text-muted-foreground">versão {quote.version}</span>
            )}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ${statusTone(quote.status)}`}>
              {statusLabel(quote.status)}
            </span>
            <span>{quote.customer_name || "Cliente não informado"}</span>
            <span>· {originLabel(quote.origin)}</span>
            <span>· Validade {formatDate(quote.valid_until)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Imprimir / PDF
          </Button>
          <Button variant="outline" size="sm" onClick={copySummary}>
            <ClipboardCopy className="mr-2 h-4 w-4" /> Copiar resumo
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            onClick={() =>
              run(async () => {
                const result = await revisionFn({ data: { id } });
                navigate({ to: "/admin/orcamentos/$id", params: { id: result.id } });
              }, "Revisão criada.")
            }
          >
            <Copy className="mr-2 h-4 w-4" /> Criar revisão
          </Button>
          {!converted && !isProposal && (
            <Button size="sm" disabled={working} onClick={() => run(() => proposalFn({ data: { id } }), "Proposta gerada.")}>
              <FileCheck2 className="mr-2 h-4 w-4" /> Gerar proposta
            </Button>
          )}
          {!converted && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={working}
                onClick={() => run(() => transitionFn({ data: { id, status: "em_negociacao" } }), "Em negociação.")}
              >
                <Handshake className="mr-2 h-4 w-4" /> Negociação
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={working}
                onClick={() => run(() => transitionFn({ data: { id, status: "aprovado" } }), "Aprovado.")}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Aprovar
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={working}
                onClick={() => {
                  const reason = window.prompt("Motivo da perda:");
                  if (!reason?.trim()) return;
                  run(
                    () => transitionFn({ data: { id, status: "recusado", lost_reason: reason.trim() } }),
                    "Perda registrada.",
                  );
                }}
              >
                <XCircle className="mr-2 h-4 w-4" /> Registrar perda
              </Button>
              <Button size="sm" disabled={working} onClick={() => setConfirmClose(true)}>
                <ShoppingCart className="mr-2 h-4 w-4" /> Fechar venda
              </Button>
            </>
          )}
          {data.salesOrder && (
            <Button asChild variant="secondary" size="sm">
              <Link to="/admin/pedidos">Abrir pedido gerado</Link>
            </Button>
          )}
        </div>
      </header>

      {converted && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 print:hidden">
          Venda fechada em {formatDateTime(quote.closed_at)}. Pedido comercial gerado — o pagamento é tratado depois, no pedido.
        </div>
      )}
      {quote.lost_reason && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 print:hidden">
          Motivo da perda: {quote.lost_reason}
        </div>
      )}

      <Tabs defaultValue={converted ? "proposta" : proposalLocked ? "proposta" : "editar"}>
        <TabsList className="print:hidden">
          <TabsTrigger value="editar" disabled={converted || proposalLocked}>
            Editar
          </TabsTrigger>
          <TabsTrigger value="proposta">Proposta</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="editar" className="mt-4 print:hidden">
          {converted ? (
            <p className="text-sm text-muted-foreground">
              Documento fechado e imutável. Crie uma revisão para negociar novamente.
            </p>
          ) : proposalLocked ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Proposta enviada — edição bloqueada</p>
              <p className="mt-1">
                Esta proposta é um snapshot comercial e não pode ser alterada. Para mudar preços,
                quantidades, condições ou itens, use o botão <strong>Criar revisão</strong>.
              </p>
            </div>
          ) : (
            <QuoteForm
              initial={quote}
              status={quote.status}
              onSaved={() => refresh()}
              onGenerateProposal={(quoteId) => run(() => proposalFn({ data: { id: quoteId } }), "Proposta gerada.")}
              generating={working}
            />
          )}
        </TabsContent>


        <TabsContent value="proposta" className="mt-4">
          <article className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-8 shadow-sm print:border-0 print:shadow-none">
            <header className="flex items-start justify-between border-b border-border pb-4">
              <div>
                <p className="font-display text-xl font-bold uppercase">Norte Sul Auto Peças</p>
                <p className="text-xs text-muted-foreground">
                  {data.branch ? `${data.branch.name}${data.branch.city ? ` · ${data.branch.city}` : ""}` : "Matriz"}
                </p>
              </div>
              <div className="text-right text-sm">
                <p className="font-bold">{isProposal ? "Proposta comercial" : "Orçamento"} #{quote.number}</p>
                <p className="text-xs text-muted-foreground">Versão {quote.version ?? 1}</p>
                <p className="text-xs text-muted-foreground">Validade {formatDate(quote.valid_until)}</p>
              </div>
            </header>

            <section className="grid gap-4 py-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-extrabold uppercase text-muted-foreground">Cliente</p>
                <p className="font-semibold">{quote.customer_name || "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {[quote.customer_phone, quote.customer_email].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs font-extrabold uppercase text-muted-foreground">Vendedor</p>
                <p className="font-semibold">{data.salesRep?.full_name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{data.salesRep?.email ?? ""}</p>
              </div>
            </section>

            <table className="w-full text-sm">
              <thead className="border-y border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Item</th>
                  <th className="py-2 text-right">Qtd</th>
                  <th className="py-2 text-right">Unitário</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id ?? item.name} className="border-b border-border last:border-0">
                    <td className="py-2">
                      {item.name}
                      {item.sku && <span className="block text-xs text-muted-foreground">{item.sku}</span>}
                      {item.notes && <span className="block text-xs text-muted-foreground">{item.notes}</span>}
                    </td>
                    <td className="py-2 text-right">{Number(item.qty)}</td>
                    <td className="py-2 text-right">{brl(Number(item.unit_price))}</td>
                    <td className="py-2 text-right font-semibold">{brl(Number(item.total ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{brl(Number(quote.subtotal ?? 0))}</dd></div>
              <div className="flex justify-between"><dt>Desconto</dt><dd>-{brl(Number(quote.discount ?? 0))}</dd></div>
              <div className="flex justify-between"><dt>Frete</dt><dd>{brl(Number(quote.shipping_amount ?? 0))}</dd></div>
              <div className="flex justify-between border-t border-border pt-1 text-base font-bold">
                <dt>Total</dt><dd>{brl(Number(quote.total ?? 0))}</dd>
              </div>
            </dl>

            <section className="mt-6 space-y-2 text-sm">
              {quote.payment_terms && <p><strong>Pagamento:</strong> {quote.payment_terms}</p>}
              {quote.delivery_terms && <p><strong>Entrega:</strong> {quote.delivery_terms}</p>}
              {quote.customer_notes && <p className="whitespace-pre-wrap">{quote.customer_notes}</p>}
              <p className="text-xs text-muted-foreground">
                Valores sujeitos a confirmação de estoque até a data de validade.
              </p>
            </section>
          </article>
        </TabsContent>

        <TabsContent value="historico" className="mt-4 print:hidden">
          <div className="rounded-2xl border border-border bg-card p-5">
            {(data.events ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>
            ) : (
              <ol className="space-y-3">
                {(data.events as any[]).map((event) => (
                  <li key={event.id} className="flex gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div>
                      <p className="text-sm font-semibold">{eventLabel(event.event_type)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(event.created_at)}
                        {event.from_status && event.to_status
                          ? ` · ${statusLabel(event.from_status)} → ${statusLabel(event.to_status)}`
                          : ""}
                      </p>
                      {event.note && <p className="mt-1 text-sm">{event.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {quote.follow_up_at && (
              <p className="mt-4 text-xs text-muted-foreground">
                Próximo acompanhamento: {formatDate(quote.follow_up_at)}
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar a venda deste orçamento?</AlertDialogTitle>
            <AlertDialogDescription>
              Será criado um pedido comercial com os itens e preços aceitos. O estoque disponível é conferido e
              nenhuma cobrança é gerada agora.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                run(async () => {
                  const result = await convertFn({ data: { id, approve_if_negotiating: true } });
                  if (result.alreadyConverted) toast.info("Este orçamento já tinha um pedido gerado.");
                }, "Venda fechada e pedido gerado.")
              }
            >
              Confirmar fechamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>

      </AlertDialog>
    </div>
  );
}
