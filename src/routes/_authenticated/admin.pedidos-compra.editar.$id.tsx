import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { PurchaseOrderForm } from "@/components/admin/PurchaseOrderForm";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { getPurchaseOrder } from "@/lib/supplies.functions";
import { num } from "@/lib/supplies-ui";

export const Route = createFileRoute("/_authenticated/admin/pedidos-compra/editar/$id")({
  head: () => ({
    meta: [
      { title: "Editar pedido de compra · Admin" },
      { name: "description", content: "Edição de pedido de compra em rascunho." },
    ],
  }),
  component: EditarPedidoCompraPage,
});

function EditarPedidoCompraPage() {
  return (
    <SupplyGuard>
      <EditarPedidoCompra />
    </SupplyGuard>
  );
}

function EditarPedidoCompra() {
  const { id } = Route.useParams();
  const getFn = useServerFn(getPurchaseOrder);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["purchase-order", id],
    queryFn: () => getFn({ data: { id } }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando pedido…</p>;

  const order = data?.order as any;
  if (isError || !order) {
    return (
      <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
        {(error as Error)?.message ?? "Pedido de compra não encontrado."}
      </div>
    );
  }

  if (order.status !== "draft") {
    return (
      <div className="mx-auto max-w-2xl space-y-3 rounded-lg border border-border bg-card p-6">
        <h1 className="font-display text-xl font-bold uppercase">Pedido não editável</h1>
        <p className="text-sm text-muted-foreground">
          Somente pedidos em rascunho podem ser editados. Este pedido já foi aprovado, enviado, recebido ou
          cancelado.
        </p>
        <Button variant="outline" asChild>
          <Link to="/admin/pedidos-compra/$id" params={{ id }}>
            Ver pedido
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <PurchaseOrderForm
      initial={{
        id,
        supplier_id: order.supplier_id ?? "",
        warehouse_id: order.warehouse_id ?? "",
        expected_at: (order.expected_at ?? "").slice(0, 10),
        payment_terms: order.payment_terms ?? "",
        freight_amount: num(order.freight_amount),
        discount_amount: num(order.discount_amount),
        other_amount: num(order.other_amount),
        notes: order.notes ?? "",
        items: (data?.items ?? []).map((item: any) => ({
          product_id: item.product_id as string,
          label: (item.product?.name ?? "Produto") as string,
          sku: (item.product?.sku ?? "") as string,
          ordered_qty: num(item.ordered_qty),
          unit_cost: num(item.unit_cost),
        })),
      }}
    />
  );
}
