import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Banknote,
  Box,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  ExternalLink,
  FileCheck2,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  ReceiptText,
  Send,
  ShoppingBag,
  Truck,
  UserRound,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { brl } from "@/lib/format";
import {
  getAdminOrderDetail,
  updateAdminOrderOperation,
  type OrderOperation,
} from "@/lib/order.functions";

export const Route = createFileRoute("/_authenticated/admin/pedidos/$id")({
  head: () => ({ meta: [{ title: "Detalhe do pedido · Admin" }] }),
  component: OrderDetailPage,
});

const orderFlow = [
  "aguardando_pagamento",
  "pago",
  "faturado",
  "enviado",
  "entregue",
] as const;

const statusLabels: Record<string, string> = {
  rascunho: "Rascunho",
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago",
  faturado: "Faturado",
  enviado: "Enviado",
  entregue: "Entregue",
  cancelado: "Cancelado",
  created: "Criado",
  pending: "Pendente",
  requires_action: "Requer ação",
  authorized: "Autorizado",
  paid: "Pago",
  failed: "Falhou",
  cancelled: "Cancelado",
  expired: "Expirado",
  partially_refunded: "Parcialmente estornado",
  refunded: "Estornado",
};

const statusTone: Record<string, string> = {
  rascunho: "bg-slate-100 text-slate-700",
  aguardando_pagamento: "bg-amber-100 text-amber-800",
  pago: "bg-emerald-100 text-emerald-800",
  faturado: "bg-blue-100 text-blue-800",
  enviado: "bg-violet-100 text-violet-800",
  entregue: "bg-cyan-100 text-cyan-800",
  cancelado: "bg-rose-100 text-rose-800",
  created: "bg-slate-100 text-slate-700",
  pending: "bg-amber-100 text-amber-800",
  requires_action: "bg-orange-100 text-orange-800",
  authorized: "bg-blue-100 text-blue-800",
  paid: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-rose-100 text-rose-800",
  expired: "bg-slate-100 text-slate-700",
  partially_refunded: "bg-violet-100 text-violet-800",
  refunded: "bg-violet-100 text-violet-800",
};

const actionByStatus: Record<string, { operation: OrderOperation; label: string; icon: typeof CheckCircle2; tone: string } | undefined> = {
  aguardando_pagamento: {
    operation: "confirm_payment",
    label: "Confirmar pagamento",
    icon: CheckCircle2,
    tone: "bg-emerald-600 text-white hover:bg-emerald-700",
  },
  pago: {
    operation: "invoice",
    label: "Marcar como faturado",
    icon: FileCheck2,
    tone: "bg-blue-600 text-white hover:bg-blue-700",
  },
  faturado: {
    operation: "ship",
    label: "Marcar como enviado",
    icon: Send,
    tone: "bg-violet-600 text-white hover:bg-violet-700",
  },
  enviado: {
    operation: "deliver",
    label: "Confirmar entrega",
    icon: PackageCheck,
    tone: "bg-cyan-600 text-white hover:bg-cyan-700",
  },
};

function labelStatus(status: string | null | undefined) {
  return statusLabels[status ?? ""] ?? (status || "Sem status").replaceAll("_", " ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function OrderDetailPage() {
  const { id } = Route.useParams();
  const detailFn = useServerFn(getAdminOrderDetail);
  const operationFn = useServerFn(updateAdminOrderOperation);
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const detail = useQuery({
    queryKey: ["admin-order-detail", id],
    queryFn: () => detailFn({ data: { orderId: id } }),
  });

  const operation = useMutation({
    mutationFn: (input: { operation: OrderOperation; note?: string }) =>
      operationFn({ data: { orderId: id, ...input } }),
    onSuccess: async () => {
      setNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-order-detail", id] }),
        queryClient.invalidateQueries({ queryKey: ["admin-orders"] }),
      ]);
    },
  });

  if (detail.isLoading) {
    return <div className="mx-auto max-w-7xl rounded-3xl border border-dashed p-12 text-center text-muted-foreground">Carregando pedido…</div>;
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center">
        <CircleAlert className="mx-auto h-8 w-8 text-rose-600" aria-hidden="true" />
        <h1 className="mt-3 font-display text-xl font-extrabold">Pedido indisponível</h1>
        <p className="mt-2 text-sm text-rose-800">{(detail.error as Error)?.message ?? "Não foi possível carregar este pedido."}</p>
        <Link to="/admin/pedidos" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-rose-600 px-4 text-sm font-bold text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Voltar aos pedidos
        </Link>
      </div>
    );
  }

  const { order, items, payments, history } = detail.data as any;
  const action = actionByStatus[order.status];
  const ActionIcon = action?.icon;
  const currentFlowIndex = orderFlow.indexOf(order.status);
  const itemCount = items.reduce((sum: number, item: any) => sum + Number(item.quantity), 0);

  function runOperation(nextOperation: OrderOperation) {
    const warning =
      nextOperation === "confirm_payment"
        ? "Confirmar o pagamento consumirá a reserva e dará baixa no estoque. Deseja continuar?"
        : nextOperation === "cancel"
          ? "Cancelar liberará a reserva deste pedido. Deseja continuar?"
          : "Confirma esta atualização operacional?";

    if (!window.confirm(warning)) return;
    operation.mutate({ operation: nextOperation, note });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="admin-page-hero">
        <div className="relative z-10">
          <Link to="/admin/pedidos" className="inline-flex items-center gap-1 text-sm font-bold text-violet-700 hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Pedidos
          </Link>
          <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-extrabold text-violet-700">
                  {order.is_b2b ? "PEDIDO B2B" : "PEDIDO B2C"}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${statusTone[order.status] ?? "bg-slate-100 text-slate-700"}`}>
                  {labelStatus(order.status)}
                </span>
              </div>
              <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                Pedido #{order.id.slice(0, 8)}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Criado em {formatDate(order.created_at)} · {itemCount} {itemCount === 1 ? "item" : "itens"}
                {order.bling_number ? ` · Bling #${order.bling_number}` : ""}
              </p>
            </div>
            <div className="rounded-3xl border border-emerald-200 bg-white/80 px-5 py-4 shadow-sm">
              <p className="text-xs font-bold text-muted-foreground">TOTAL DO PEDIDO</p>
              <p className="mt-1 font-display text-3xl font-extrabold text-emerald-700">{brl(Number(order.total))}</p>
            </div>
          </div>
        </div>
      </header>

      {order.status !== "cancelado" && (
        <section aria-label="Progresso do pedido" className="rounded-3xl border border-blue-200/70 bg-gradient-to-r from-blue-50 via-white to-violet-50 p-5 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-5">
            {orderFlow.map((status, index) => {
              const complete = currentFlowIndex >= index;
              const current = order.status === status;
              return (
                <div key={status} className="relative flex items-center gap-2 sm:flex-col sm:text-center">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-full border-2 text-xs font-extrabold ${
                    complete ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-400"
                  } ${current ? "ring-4 ring-blue-100" : ""}`}>
                    {complete && !current ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : index + 1}
                  </span>
                  <span className={`text-xs font-bold ${complete ? "text-foreground" : "text-muted-foreground"}`}>{labelStatus(status)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
        <main className="space-y-6">
          <SectionCard icon={ShoppingBag} eyebrow="COMPRA" title="Itens do pedido">
            <div className="divide-y divide-border/70">
              {items.map((item: any) => {
                const images = item.product?.images ?? [];
                const image = [...images].sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)[0];
                return (
                  <article key={item.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                    <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-muted">
                      {image?.url ? <img src={image.url} alt={image.alt || item.name} className="h-full w-full object-contain p-1" loading="lazy" /> : <Box className="h-6 w-6 text-muted-foreground" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold">{item.name}</h3>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">SKU {item.sku}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{item.quantity} × {brl(Number(item.unit_price))}</p>
                    </div>
                    <p className="shrink-0 font-display font-extrabold">{brl(Number(item.total))}</p>
                  </article>
                );
              })}
            </div>
            <div className="mt-5 space-y-2 border-t border-border/70 pt-4 text-sm">
              <ValueRow label="Subtotal" value={brl(Number(order.subtotal))} />
              <ValueRow label="Frete" value={brl(Number(order.shipping))} />
              <ValueRow label="Desconto" value={`− ${brl(Number(order.discount))}`} />
              <ValueRow label="Total" value={brl(Number(order.total))} strong />
            </div>
          </SectionCard>

          <SectionCard icon={CreditCard} eyebrow="FINANCEIRO" title="Pagamento">
            {payments.length === 0 ? (
              <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                Nenhuma tentativa de pagamento registrada. Método informado: <strong>{order.payment_method || "não definido"}</strong>.
              </div>
            ) : (
              <div className="space-y-3">
                {payments.map((payment: any) => (
                  <article key={payment.id} className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><Banknote className="h-5 w-5" aria-hidden="true" /></span>
                        <div>
                          <p className="font-extrabold capitalize">{payment.method.replaceAll("_", " ")}</p>
                          <p className="text-xs text-muted-foreground">{payment.provider?.display_name || "Provedor não informado"}</p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${statusTone[payment.status] ?? "bg-slate-100 text-slate-700"}`}>{labelStatus(payment.status)}</span>
                    </div>
                    <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
                      <span><strong>Valor:</strong> {brl(Number(payment.amount))}</span>
                      <span><strong>Criado:</strong> {formatDate(payment.created_at)}</span>
                      <span><strong>Pago:</strong> {formatDate(payment.paid_at)}</span>
                    </div>
                    {payment.failure_message && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{payment.failure_message}</p>}
                    {(payment.checkout_url || payment.boleto_url) && (
                      <a href={payment.checkout_url || payment.boleto_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs font-bold text-primary hover:underline">
                        Abrir cobrança <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </article>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard icon={Clock3} eyebrow="AUDITORIA" title="Histórico do pedido">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
            ) : (
              <ol className="relative ml-2 border-l-2 border-violet-100 pl-6">
                {[...history].reverse().map((event: any) => (
                  <li key={event.id} className="relative pb-6 last:pb-0">
                    <span className="absolute -left-[31px] top-0 grid size-4 place-items-center rounded-full border-4 border-white bg-violet-600" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${statusTone[event.to_status] ?? "bg-slate-100 text-slate-700"}`}>{labelStatus(event.to_status)}</span>
                      <time className="text-xs text-muted-foreground">{formatDate(event.created_at)}</time>
                    </div>
                    {event.from_status && <p className="mt-1 text-xs text-muted-foreground">De {labelStatus(event.from_status)} para {labelStatus(event.to_status)}</p>}
                    {event.note && <p className="mt-2 text-sm">{event.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </main>

        <aside className="space-y-5">
          <SectionCard icon={UserRound} eyebrow="CLIENTE" title={order.customer_name}>
            <div className="space-y-3 text-sm">
              <InfoLine icon={Mail} value={order.customer_email} />
              <InfoLine icon={Phone} value={order.customer_phone || "Telefone não informado"} />
              <InfoLine icon={ReceiptText} value={order.customer_document || "Documento não informado"} />
            </div>
          </SectionCard>

          <SectionCard icon={MapPin} eyebrow="ENTREGA" title="Endereço">
            <address className="text-sm not-italic leading-6 text-muted-foreground">
              {order.shipping_street || "Endereço não informado"}{order.shipping_number ? `, ${order.shipping_number}` : ""}
              {order.shipping_complement ? <><br />{order.shipping_complement}</> : null}
              <br />{order.shipping_neighborhood || "—"}
              <br />{order.shipping_city || "—"}{order.shipping_state ? `/${order.shipping_state}` : ""}
              <br />CEP {order.shipping_zip || "—"}
            </address>
          </SectionCard>

          <section className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm">
            <p className="text-xs font-extrabold text-violet-700">ATUALIZAÇÃO OPERACIONAL</p>
            <h2 className="mt-1 font-display text-xl font-extrabold">Próxima ação</h2>
            {operation.isError && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{(operation.error as Error).message}</p>}
            {operation.isSuccess && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">Pedido atualizado com sucesso.</p>}

            {action && ActionIcon ? (
              <>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-xs font-bold text-muted-foreground">Observação para o histórico</span>
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder="Ex.: NF-e 123 emitida ou coleta realizada" className="w-full resize-none" />
                </label>
                <button type="button" onClick={() => runOperation(action.operation)} disabled={operation.isPending} className={`mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-extrabold shadow-sm transition disabled:cursor-wait disabled:opacity-60 ${action.tone}`}>
                  <ActionIcon className="h-4 w-4" aria-hidden="true" /> {operation.isPending ? "Atualizando…" : action.label}
                </button>
                {order.status === "aguardando_pagamento" && (
                  <button type="button" onClick={() => runOperation("cancel")} disabled={operation.isPending} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-white px-4 text-sm font-extrabold text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                    <XCircle className="h-4 w-4" aria-hidden="true" /> Cancelar pedido
                  </button>
                )}
              </>
            ) : (
              <div className="mt-4 rounded-2xl bg-white/70 p-4 text-sm text-muted-foreground">
                {order.status === "entregue" ? "Fluxo concluído. O pedido foi entregue." : order.status === "cancelado" ? "Este pedido foi cancelado." : "Não há ação operacional disponível para este status."}
              </div>
            )}
          </section>

          {order.notes && (
            <SectionCard icon={Truck} eyebrow="OBSERVAÇÕES" title="Notas do pedido">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{order.notes}</p>
            </SectionCard>
          )}
        </aside>
      </div>
    </div>
  );
}

function SectionCard({ icon: Icon, eyebrow, title, children }: { icon: typeof ShoppingBag; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border/60 bg-gradient-to-r from-violet-500/8 via-blue-500/5 to-transparent px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700"><Icon className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold tracking-wider text-violet-700">{eyebrow}</p>
          <h2 className="truncate font-display text-lg font-extrabold">{title}</h2>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ValueRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-4 ${strong ? "pt-2 text-base font-extrabold" : "text-muted-foreground"}`}><span>{label}</span><span>{value}</span></div>;
}

function InfoLine({ icon: Icon, value }: { icon: typeof Mail; value: string }) {
  return <div className="flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" /><span className="break-all text-muted-foreground">{value}</span></div>;
}
