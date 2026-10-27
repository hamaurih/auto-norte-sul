import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  BadgeCheck,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Filter,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  RotateCw,
  ScanLine,
  Search,
  Send,
  ShoppingBag,
  Store,
  Truck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { brl } from "@/lib/format";
import {
  getOmnichannelOperationsCenter,
  retryAdminOrderBling,
  type OperationsOrder,
  type OperationsStage,
} from "@/lib/operations-center.functions";
import { startOrderDispatch } from "@/lib/dispatch.functions";
import { updateAdminOrderOperation, type OrderOperation } from "@/lib/order.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/pedidos")({
  head: () => ({ meta: [{ title: "Central Operacional de Pedidos · Norte Sul" }] }),
  component: OrdersOperationsCenter,
});

const STAGES: Array<{ key: "" | OperationsStage; label: string }> = [
  { key: "", label: "Todos" },
  { key: "novo", label: "Novo" },
  { key: "pagamento", label: "Pagamento" },
  { key: "separacao", label: "Separação" },
  { key: "conferencia", label: "Conferência" },
  { key: "pronto", label: "Pronto" },
  { key: "entrega_retirada", label: "Entrega / Retirada" },
  { key: "concluido", label: "Concluído" },
  { key: "cancelado", label: "Cancelado" },
];

const stageStyle: Record<OperationsStage, string> = {
  novo: "bg-slate-100 text-slate-700",
  pagamento: "bg-amber-100 text-amber-800",
  separacao: "bg-blue-100 text-blue-800",
  conferencia: "bg-violet-100 text-violet-800",
  pronto: "bg-emerald-100 text-emerald-800",
  entrega_retirada: "bg-cyan-100 text-cyan-800",
  concluido: "bg-teal-100 text-teal-800",
  cancelado: "bg-rose-100 text-rose-800",
};

const stageLabel = Object.fromEntries(STAGES.filter((s) => s.key).map((s) => [s.key, s.label])) as Record<OperationsStage, string>;

const channelMeta: Record<string, { label: string; className: string; icon: typeof Store }> = {
  site: { label: "Site", className: "bg-blue-50 text-blue-700", icon: Store },
  pdv: { label: "PDV", className: "bg-emerald-50 text-emerald-700", icon: ScanLine },
  whatsapp: { label: "WhatsApp", className: "bg-violet-50 text-violet-700", icon: MessageCircle },
  vendedor: { label: "Assistida", className: "bg-fuchsia-50 text-fuchsia-700", icon: ShoppingBag },
  default: { label: "Padrão", className: "bg-slate-100 text-slate-700", icon: ShoppingBag },
};

const actionLabel: Record<NonNullable<OperationsOrder["nextAction"]>, string> = {
  start_dispatch: "Iniciar separação",
  open_dispatch: "Abrir conferência",
  invoice: "Faturar",
  ship: "Despachar",
  deliver: "Confirmar entrega",
  ready_pickup: "Pronto p/ retirada",
  complete_pickup: "Confirmar retirada",
};

function OperationsCenter() {
  const siteOnly = useRouterState({ select: (state) => state.location.searchStr.includes("canal=site") });
  const listFn = useServerFn(getOmnichannelOperationsCenter);
  const startDispatchFn = useServerFn(startOrderDispatch);
  const operationFn = useServerFn(updateAdminOrderOperation);
  const retryBlingFn = useServerFn(retryAdminOrderBling);
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState(siteOnly ? "site" : "");
  const [stage, setStage] = useState<"" | OperationsStage>("");
  const [fulfillment, setFulfillment] = useState<"" | "delivery" | "pickup">("");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (siteOnly) setChannel("site");
  }, [siteOnly]);

  useEffect(() => setPage(0), [query, channel, stage, fulfillment, exceptionsOnly]);

  const center = useQuery({
    queryKey: ["operations-center", query, channel, stage, fulfillment, exceptionsOnly, page],
    queryFn: () => listFn({
      data: {
        query,
        channel,
        stage,
        fulfillment,
        exceptionsOnly,
        page,
        pageSize: 50,
      },
    }),
    refetchInterval: 30_000,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["operations-center"] });
  };

  const startDispatch = useMutation({
    mutationFn: (orderId: string) => startDispatchFn({ data: { orderId } }),
    onSuccess: async () => { toast.success("Separação iniciada."); await refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const operate = useMutation({
    mutationFn: ({ orderId, operation }: { orderId: string; operation: OrderOperation }) =>
      operationFn({ data: { orderId, operation, note: "Atualização pela Central Operacional." } }),
    onSuccess: async () => { toast.success("Pedido atualizado."); await refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const retryBling = useMutation({
    mutationFn: (orderId: string) => retryBlingFn({ data: { orderId } }),
    onSuccess: async (result) => {
      toast.success(result.alreadySynced ? "Pedido já estava sincronizado." : "Nova tentativa do Bling executada.");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = center.data;
  const rows = data?.rows ?? [];
  const summary = data?.summary;
  const totalPages = Math.max(1, Math.ceil((data?.totalFiltered ?? 0) / 50));

  function handleAction(order: OperationsOrder) {
    const action = order.nextAction;
    if (!action || action === "open_dispatch") return;
    if (action === "start_dispatch") {
      startDispatch.mutate(order.id);
      return;
    }
    const map: Record<Exclude<typeof action, "start_dispatch" | "open_dispatch">, OrderOperation> = {
      invoice: "invoice",
      ship: "ship",
      deliver: "deliver",
      ready_pickup: "ready_pickup",
      complete_pickup: "complete_pickup",
    };
    const operation = map[action];
    const confirmed = window.confirm(`Confirmar: ${actionLabel[action]}?`);
    if (confirmed) operate.mutate({ orderId: order.id, operation });
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
      <header className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider">
              <Boxes className="h-3.5 w-3.5" /> Operação omnichannel
            </span>
            <h1 className="mt-3 font-display text-3xl font-black sm:text-4xl">Central Operacional de Pedidos</h1>
            <p className="mt-2 max-w-3xl text-sm text-white/70">
              Site, PDV e WhatsApp em uma única fila. Prioridade por exceção e tempo parado, com separação, conferência, retirada e entrega no mesmo fluxo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void center.refetch()}
            disabled={center.isFetching}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold hover:bg-white/15 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${center.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Clock3} label="Em operação" value={summary?.active ?? 0} detail="Pedidos ainda não concluídos" />
        <Metric icon={PackageCheck} label="Prontos" value={summary?.ready ?? 0} detail="Aguardando expedição ou retirada" />
        <Metric icon={AlertTriangle} label="Exceções" value={summary?.exceptions ?? 0} detail="SLA, pagamento, logística ou Bling" critical={Boolean(summary?.exceptions)} />
        <Metric icon={BadgeCheck} label="Com ação disponível" value={summary?.actionRequired ?? 0} detail="Podem avançar agora" />
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {(summary?.channelSummary ?? []).map((item) => {
          const meta = channelMeta[item.code] ?? channelMeta.default;
          const Icon = meta.icon;
          return (
            <button
              key={item.code}
              type="button"
              onClick={() => setChannel(channel === item.code ? "" : item.code)}
              className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-blue-300 ${channel === item.code ? "ring-2 ring-blue-500" : ""}`}
            >
              <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-bold ${meta.className}`}><Icon className="h-3.5 w-3.5" />{meta.label}</span>
              <p className="mt-3 text-2xl font-black">{item.orders}</p>
              <p className="text-xs text-slate-500">{brl(item.gross)} em pedidos do período carregado</p>
            </button>
          );
        })}
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_160px_170px_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pedido, cliente, e-mail ou nº Bling"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm"
            />
          </label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="">Todos os canais</option>
            <option value="site">Site</option>
            <option value="pdv">PDV</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="vendedor">Venda assistida</option>
          </select>
          <select value={fulfillment} onChange={(e) => setFulfillment(e.target.value as any)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="">Entrega + retirada</option>
            <option value="delivery">Entrega</option>
            <option value="pickup">Retirada</option>
          </select>
          <button
            type="button"
            onClick={() => setExceptionsOnly((value) => !value)}
            className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold ${exceptionsOnly ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200"}`}
          >
            <Filter className="h-4 w-4" /> Só exceções
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {STAGES.map((item) => (
            <button
              key={item.key || "all"}
              type="button"
              onClick={() => setStage(item.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${stage === item.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600"}`}
            >
              {item.label}{item.key && summary?.stageCounts ? ` · ${summary.stageCounts[item.key] ?? 0}` : ""}
            </button>
          ))}
        </div>
      </section>

      {center.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          {(center.error as Error)?.message ?? "Não foi possível carregar a central operacional."}
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Prioridade / Pedido</th>
                  <th className="px-4 py-3 text-left">Canal / Cliente</th>
                  <th className="px-4 py-3 text-left">Etapa</th>
                  <th className="px-4 py-3 text-left">Pagamento</th>
                  <th className="px-4 py-3 text-left">Fulfillment</th>
                  <th className="px-4 py-3 text-left">Bling</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((order) => <OrderRow key={order.id} order={order} onAction={handleAction} onRetryBling={() => retryBling.mutate(order.id)} busy={startDispatch.isPending || operate.isPending || retryBling.isPending} />)}
              </tbody>
            </table>
          </div>
          {!center.isLoading && rows.length === 0 && (
            <div className="p-10 text-center text-sm text-slate-500">Nenhum pedido encontrado para estes filtros.</div>
          )}
          {center.isLoading && <div className="p-10 text-center text-sm text-slate-500">Carregando operação…</div>}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
        <span>{data?.totalFiltered ?? 0} pedido(s) encontrados · atualização automática a cada 30s</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page === 0 || center.isFetching} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded-lg border bg-white p-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <span>Página {page + 1} de {totalPages}</span>
          <button type="button" disabled={page + 1 >= totalPages || center.isFetching} onClick={() => setPage((p) => p + 1)} className="rounded-lg border bg-white p-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}

function OrderRow({ order, onAction, onRetryBling, busy }: { order: OperationsOrder; onAction: (order: OperationsOrder) => void; onRetryBling: () => void; busy: boolean }) {
  const meta = channelMeta[order.channelCode] ?? channelMeta.default;
  const Icon = meta.icon;
  const critical = order.issues.some((issue) => issue.severity === "critical");
  const hasBlingProblem = order.issues.some((issue) => issue.code === "bling_error" || issue.code === "bling_pending");

  return (
    <tr className={critical ? "bg-rose-50/40" : order.issues.length ? "bg-amber-50/30" : ""}>
      <td className="px-4 py-4">
        <div className="flex items-start gap-3">
          <span className={`mt-1 size-2.5 shrink-0 rounded-full ${critical ? "bg-rose-500" : order.issues.length ? "bg-amber-500" : "bg-emerald-500"}`} />
          <div>
            <Link to="/admin/pedidos/$id" params={{ id: order.id }} className="font-mono text-xs font-black text-blue-700 hover:underline">#{order.id.slice(0, 8)}</Link>
            <p className="mt-1 text-xs text-slate-500">{new Date(order.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
            {order.issues.length > 0 && (
              <div className="mt-2 space-y-1">
                {order.issues.slice(0, 2).map((issue) => <p key={issue.code} className={`text-[11px] font-bold ${issue.severity === "critical" ? "text-rose-700" : "text-amber-700"}`}>⚠ {issue.label}</p>)}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.className}`}><Icon className="h-3.5 w-3.5" />{meta.label}</span>
        <p className="mt-2 max-w-[220px] truncate font-bold">{order.customerName}</p>
        <p className="max-w-[220px] truncate text-xs text-slate-500">{order.customerEmail ?? "Sem e-mail"}{order.isB2B ? " · B2B" : ""}</p>
      </td>
      <td className="px-4 py-4">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${stageStyle[order.stage]}`}>{stageLabel[order.stage]}</span>
        <p className="mt-2 text-xs text-slate-500">{formatAge(order.ageMinutes)} nesta etapa</p>
        {order.dispatchStatus && <p className="mt-1 text-[11px] text-slate-400">Conferência: {order.dispatchStatus}</p>}
      </td>
      <td className="px-4 py-4">
        <FinancialChip status={order.financialStatus} />
        <p className="mt-2 text-xs font-semibold uppercase text-slate-500">{order.paymentMethod ?? "—"}</p>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-2 font-semibold">{order.fulfillmentType === "pickup" ? <Store className="h-4 w-4 text-emerald-600" /> : <Truck className="h-4 w-4 text-blue-600" />}{order.fulfillmentType === "pickup" ? "Retirada" : "Entrega"}</div>
        {order.shipmentStatus && <p className="mt-1 text-xs text-slate-500">Logística: {order.shipmentStatus.replaceAll("_", " ")}</p>}
        {order.pickupStatus && <p className="mt-1 text-xs text-slate-500">Retirada: {order.pickupStatus.replaceAll("_", " ")}</p>}
      </td>
      <td className="px-4 py-4">
        <p className={`font-bold ${hasBlingProblem ? "text-rose-700" : "text-slate-700"}`}>{order.blingNumber ? `#${order.blingNumber}` : order.blingSyncStatus.replaceAll("_", " ")}</p>
        {hasBlingProblem && (
          <button type="button" disabled={busy} onClick={onRetryBling} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-rose-700 hover:underline disabled:opacity-50"><RotateCw className="h-3 w-3" />Tentar novamente</button>
        )}
      </td>
      <td className="px-4 py-4 text-right font-black">{brl(order.total)}</td>
      <td className="px-4 py-4 text-right">
        {order.nextAction === "open_dispatch" ? (
          <Link to="/admin/pedidos/$id" params={{ id: order.id }} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white"><ScanLine className="h-3.5 w-3.5" />Conferir</Link>
        ) : order.nextAction ? (
          <button type="button" disabled={busy} onClick={() => onAction(order)} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50">
            {order.nextAction === "start_dispatch" ? <Boxes className="h-3.5 w-3.5" /> : order.nextAction === "ship" ? <Send className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {actionLabel[order.nextAction]}
          </button>
        ) : (
          <Link to="/admin/pedidos/$id" params={{ id: order.id }} className="text-xs font-bold text-blue-700 hover:underline">Abrir pedido</Link>
        )}
      </td>
    </tr>
  );
}

function Metric({ icon: Icon, label, value, detail, critical = false }: { icon: typeof ShoppingBag; label: string; value: number; detail: string; critical?: boolean }) {
  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm ${critical ? "border-rose-200" : "border-slate-200"}`}>
      <div className="flex items-center gap-3">
        <span className={`grid size-10 place-items-center rounded-xl ${critical ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}><Icon className="h-5 w-5" /></span>
        <div><p className="text-xs font-bold text-slate-500">{label}</p><p className="text-2xl font-black">{value}</p></div>
      </div>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function FinancialChip({ status }: { status: OperationsOrder["financialStatus"] }) {
  const cfg = {
    paid: ["Pago", "bg-emerald-100 text-emerald-800"],
    pending: ["Pendente", "bg-amber-100 text-amber-800"],
    cancelled: ["Cancelado", "bg-slate-100 text-slate-600"],
    failed: ["Falhou", "bg-rose-100 text-rose-800"],
  }[status];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${cfg[1]}`}>{cfg[0]}</span>;
}

function formatAge(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function OrdersOperationsCenter() {
  return <OperationsCenter />;
}
