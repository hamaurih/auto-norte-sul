import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SupplyStatusBadge } from "@/components/admin/SupplyStatusBadge";
import { listPurchaseOrders } from "@/lib/supplies.functions";
import { brl } from "@/lib/format";
import { formatDate } from "@/lib/supplies-ui";
import { SupplyGuard } from "@/components/admin/SupplyGuard";

export const Route = createFileRoute("/_authenticated/admin/pedidos-compra/")({
  head: () => ({
    meta: [
      { title: "Pedidos de compra · Admin" },
      { name: "description", content: "Pedidos de compra do módulo de suprimentos." },
    ],
  }),
  component: GuardedPedidosCompraPage,
});

const filters = [
  { key: "open", label: "Em aberto" },
  { key: "draft", label: "Rascunhos" },
  { key: "received", label: "Recebidos" },
  { key: "cancelled", label: "Cancelados" },
  { key: "all", label: "Todos" },
] as const;

function PedidosCompraPage() {
  const listFn = useServerFn(listPurchaseOrders);
  const [status, setStatus] = useState<(typeof filters)[number]["key"]>("open");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["purchase-orders", status, search],
    queryFn: () => listFn({ data: { status, search } }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="admin-page-hero flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-blue-700">Fluxo de compras</p>\n          <h1 className="mt-1 font-display text-3xl font-bold">Pedidos de compra</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rascunho → aprovado → enviado → recebido, com controle de saldo por item.
          </p>
        </div>
        <Button asChild>
          <Link to="/admin/pedidos-compra/novo">
            <PlusCircle className="mr-2 h-4 w-4" aria-hidden="true" /> Novo pedido
          </Link>
        </Button>
      </header>

      <div className="admin-filter-bar flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setStatus(filter.key)}
            className={`min-h-9 rounded-md border px-3 text-xs font-semibold uppercase transition-colors ${
              status === filter.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
            }`}
          >
            {filter.label}
          </button>
        ))}
        <Input
          className="w-full sm:w-64"
          placeholder="Buscar por número ou fornecedor"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {isError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
          {(error as Error)?.message ?? "Não foi possível carregar os pedidos."}
        </div>
      )}

      <div className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando pedidos…</p>}
        {!isLoading && (data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum pedido de compra neste filtro.</p>
        )}
        {(data ?? []).map((order: any) => (
          <Link
            key={order.id}
            to="/admin/pedidos-compra/$id"
            params={{ id: order.id }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-blue-200/70 bg-gradient-to-br from-white to-blue-50/60 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
          >
            <div className="min-w-0">
              <div className="font-display text-lg font-bold">
                #{order.number} · {order.supplier?.legal_name ?? "Fornecedor"}
              </div>
              <div className="text-xs text-muted-foreground">
                Emitido {formatDate(order.issued_at)} · Previsão {formatDate(order.expected_at)} ·{" "}
                {order.warehouse?.name ?? "Depósito"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-display font-bold">{brl(Number(order.total_amount ?? 0))}</span>
              <SupplyStatusBadge status={order.status} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function GuardedPedidosCompraPage() {
  return (
    <SupplyGuard>
      <PedidosCompraPage />
    </SupplyGuard>
  );
}
