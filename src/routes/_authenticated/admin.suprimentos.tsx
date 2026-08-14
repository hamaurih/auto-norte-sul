import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, PackageCheck, ShoppingCart, Truck } from "lucide-react";
import { getSuppliesOverview } from "@/lib/supplies.functions";
import { brl } from "@/lib/format";

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
  const overviewFn = useServerFn(getSuppliesOverview);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["supplies-overview"],
    queryFn: () => overviewFn(),
  });

  const cards = [
    { label: "Fornecedores ativos", value: data?.activeSuppliers, icon: Truck, to: "/admin/fornecedores" },
    { label: "Pedidos em aberto", value: data?.openOrders, icon: ShoppingCart, to: "/admin/pedidos-compra" },
    { label: "Recebimentos em conferência", value: data?.pendingReceipts, icon: PackageCheck, to: "/admin/recebimentos" },
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
            <div className="mt-2 font-display text-2xl font-bold">
              {isLoading ? "…" : (card.value ?? "—")}
            </div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {card.label}
            </div>
          </Link>
        ))}
        <div className="rounded-lg border border-border bg-card p-4">
          <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
          <div className="mt-2 font-display text-2xl font-bold">
            {isLoading ? "…" : data?.openOrdersValue == null ? "—" : brl(data.openOrdersValue)}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Valor comprometido em compras
          </div>
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
    </div>
  );
}
