import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ClipboardList, Clock3, FileWarning, PackageCheck, ShieldAlert, ShoppingCart, Truck } from "lucide-react";
import { getSuppliesOverview, getSupplyAlerts } from "@/lib/supplies.functions";
import { brl } from "@/lib/format";
import { formatDate } from "@/lib/supplies-ui";
import { SupplyStatusBadge } from "@/components/admin/SupplyStatusBadge";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/admin/suprimentos")({
  head: () => ({
    meta: [
      { title: "Suprimentos e Compras · Admin" },
      { name: "description", content: "Fornecedores, pedidos de compra e recebimento de mercadorias." },
    ],
  }),
  component: SuprimentosPage,
});

function SuprimentosPage() {
  const { isStaff, loading: sessionLoading } = useSession();
  const overviewFn = useServerFn(getSuppliesOverview);
  const alertsFn = useServerFn(getSupplyAlerts);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["supplies-overview"],
    queryFn: () => overviewFn(),
    enabled: isStaff,
  });

  const { data: alerts, isLoading: alertsLoading, isError: alertsError } = useQuery({
    queryKey: ["supply-alerts"],
    queryFn: () => alertsFn(),
    enabled: isStaff,
  });

  if (sessionLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Carregando permissões…</p>;
  }

  if (!isStaff) {
    return (
      <div role="alert" className="mx-auto max-w-2xl rounded-lg border border-destructive bg-destructive/5 p-6">
        <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
        <h1 className="mt-2 font-display text-xl font-bold uppercase">Acesso restrito</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O módulo de Suprimentos é exclusivo para perfis de administração e gerência.
        </p>
      </div>
    );
  }

  const cards = [
    {
      label: "Pedidos em aberto",
      value: isLoading ? "…" : (data?.openOrders ?? "—"),
      icon: ShoppingCart,
      to: "/admin/pedidos-compra",
    },
    {
      label: "Aguardando recebimento",
      value: isLoading ? "…" : (data?.awaitingReceipt ?? "—"),
      icon: Truck,
      to: "/admin/pedidos-compra",
    },
    {
      label: "Recebimentos em conferência",
      value: isLoading ? "…" : (data?.pendingReceipts ?? "—"),
      icon: PackageCheck,
      to: "/admin/recebimentos",
    },
    {
      label: "Fornecedores ativos",
      value: isLoading ? "…" : (data?.activeSuppliers ?? "—"),
      icon: Truck,
      to: "/admin/fornecedores",
    },
  ] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase">Suprimentos e Compras</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastre fornecedores, emita pedidos de compra e dê entrada nas mercadorias com atualização
          automática de estoque e custo.
        </p>
      </header>

      {isError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
          Não foi possível carregar os indicadores: {(error as Error)?.message ?? "erro desconhecido"}.
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            to={card.to}
            className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <card.icon className="h-5 w-5 text-primary" aria-hidden="true" />
            <div className="mt-2 font-display text-2xl font-bold">{card.value}</div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {card.label}
            </div>
          </Link>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
          <div className="mt-2 font-display text-2xl font-bold">
            {isLoading ? "…" : data?.openOrdersValue == null ? "—" : brl(data.openOrdersValue)}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Valor comprometido em compras
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
          <div className="mt-2 font-display text-2xl font-bold">
            {isLoading ? "…" : data?.purchasedValue30d == null ? "—" : brl(data.purchasedValue30d)}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Valor comprado (últimos 30 dias)
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold">Recebimentos recentes</h2>
          <Link to="/admin/recebimentos" className="text-xs font-semibold uppercase text-primary hover:underline">
            Ver todos
          </Link>
        </div>
        <div className="mt-3 space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Carregando recebimentos…</p>}
          {!isLoading && (data?.recentReceipts ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum recebimento registrado ainda.</p>
          )}
          {(data?.recentReceipts ?? []).map((receipt: any) => (
            <Link
              key={receipt.id}
              to="/admin/recebimentos/$id"
              params={{ id: receipt.id }}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm transition-colors hover:border-primary/40"
            >
              <span className="min-w-0">
                <span className="font-semibold">#{receipt.number}</span> ·{" "}
                {receipt.supplier?.legal_name ?? "Fornecedor"}
                <span className="block text-xs text-muted-foreground">
                  Pedido #{receipt.purchase_order?.number ?? "—"} · {formatDate(receipt.received_at)}
                  {receipt.invoice_number ? ` · NF ${receipt.invoice_number}` : ""}
                </span>
              </span>
              <SupplyStatusBadge status={receipt.status} kind="receipt" />
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link
          to="/admin/fornecedores"
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <h2 className="font-display text-lg font-bold">Fornecedores</h2>
          <p className="mt-1 text-sm text-muted-foreground">Cadastro completo, contatos, prazo médio e condições.</p>
        </Link>
        <Link
          to="/admin/pedidos-compra"
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <h2 className="font-display text-lg font-bold">Pedidos de compra</h2>
          <p className="mt-1 text-sm text-muted-foreground">Rascunho, aprovação, envio e acompanhamento do recebido.</p>
        </Link>
        <Link
          to="/admin/recebimentos"
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <h2 className="font-display text-lg font-bold">Recebimentos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Conferência por SKU, recebimento parcial, custo efetivo e estorno auditado.
          </p>
        </Link>
      </section>


      <section className="space-y-3" aria-labelledby="supply-alerts-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="supply-alerts-title" className="font-display text-xl font-bold uppercase">
              Alertas operacionais
            </h2>
            <p className="text-sm text-muted-foreground">
              Pendências que exigem aprovação, conferência ou cobrança do fornecedor.
            </p>
          </div>
          {alertsLoading && <span className="text-xs text-muted-foreground">Atualizando…</span>}
        </div>

        {alertsError && (
          <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
            Não foi possível carregar os alertas operacionais.
          </div>
        )}

        {!alertsLoading && !alertsError &&
          (alerts?.overdueOrders.length ?? 0) +
            (alerts?.approvalQueue.length ?? 0) +
            (alerts?.divergentNfes.length ?? 0) +
            (alerts?.draftReceipts.length ?? 0) ===
            0 && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
              Nenhuma pendência crítica no módulo de Suprimentos.
            </div>
          )}

        <div className="grid gap-3 lg:grid-cols-2">
          {(alerts?.overdueOrders.length ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 font-display font-bold uppercase">
                <Clock3 className="h-5 w-5 text-amber-600" aria-hidden="true" />
                Pedidos atrasados ({alerts?.overdueOrders.length})
              </div>
              <div className="mt-2 space-y-1">
                {alerts?.overdueOrders.slice(0, 5).map((order: any) => (
                  <Link
                    key={order.id}
                    to="/admin/pedidos-compra/$id"
                    params={{ id: order.id }}
                    className="flex justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span>#{order.number} · {order.supplier?.legal_name ?? "Fornecedor"}</span>
                    <span className="text-muted-foreground">{formatDate(order.expected_at)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(alerts?.approvalQueue.length ?? 0) > 0 && (
            <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-4">
              <div className="flex items-center gap-2 font-display font-bold uppercase">
                <ClipboardList className="h-5 w-5 text-blue-600" aria-hidden="true" />
                Aguardando aprovação ({alerts?.approvalQueue.length})
              </div>
              <div className="mt-2 space-y-1">
                {alerts?.approvalQueue.slice(0, 5).map((order: any) => (
                  <Link
                    key={order.id}
                    to="/admin/pedidos-compra/$id"
                    params={{ id: order.id }}
                    className="flex justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span>#{order.number} · {order.supplier?.legal_name ?? "Fornecedor"}</span>
                    <span className="font-semibold">{brl(Number(order.total_amount ?? 0))}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(alerts?.divergentNfes.length ?? 0) > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 font-display font-bold uppercase">
                <FileWarning className="h-5 w-5 text-destructive" aria-hidden="true" />
                NF-e com divergência ({alerts?.divergentNfes.length})
              </div>
              <div className="mt-2 space-y-1">
                {alerts?.divergentNfes.slice(0, 5).map((nfe: any) => (
                  <Link
                    key={nfe.id}
                    to="/admin/nfe-importacao/$id"
                    params={{ id: nfe.id }}
                    className="flex justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span>NF {nfe.nfe_number ?? "—"} · {nfe.emitter_name ?? "Emitente"}</span>
                    <span className="font-semibold">{brl(Number(nfe.total_invoice ?? 0))}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(alerts?.draftReceipts.length ?? 0) > 0 && (
            <div className="rounded-lg border border-orange-500/40 bg-orange-500/5 p-4">
              <div className="flex items-center gap-2 font-display font-bold uppercase">
                <AlertTriangle className="h-5 w-5 text-orange-600" aria-hidden="true" />
                Recebimentos sem confirmação ({alerts?.draftReceipts.length})
              </div>
              <div className="mt-2 space-y-1">
                {alerts?.draftReceipts.slice(0, 5).map((receipt: any) => (
                  <Link
                    key={receipt.id}
                    to="/admin/recebimentos/$id"
                    params={{ id: receipt.id }}
                    className="flex justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span>#{receipt.number} · {receipt.supplier?.legal_name ?? "Fornecedor"}</span>
                    <span className="text-muted-foreground">{formatDate(receipt.received_at)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
        <Link
          to="/admin/reposicao"
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <h2 className="font-display text-lg font-bold">Reposição inteligente</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Risco de ruptura, cobertura, excesso e quantidade sugerida para compra.
          </p>
        </Link>
        <Link
          to="/admin/inteligencia-comercial"
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <h2 className="font-display text-lg font-bold">Inteligência comercial</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Curva ABC, margem, markup, rentabilidade e formação de preço.
          </p>
        </Link>
      </section>
    </div>
  );
}
