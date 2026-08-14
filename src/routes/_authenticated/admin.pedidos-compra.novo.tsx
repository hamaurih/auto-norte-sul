import { createFileRoute } from "@tanstack/react-router";
import { PurchaseOrderForm } from "@/components/admin/PurchaseOrderForm";
import { SupplyGuard } from "@/components/admin/SupplyGuard";

export const Route = createFileRoute("/_authenticated/admin/pedidos-compra/novo")({
  head: () => ({
    meta: [
      { title: "Novo pedido de compra · Admin" },
      { name: "description", content: "Emissão de pedido de compra para fornecedor." },
    ],
  }),
  component: NovoPedidoCompraPage,
});

function NovoPedidoCompraPage() {
  return (
    <SupplyGuard>
      <PurchaseOrderForm />
    </SupplyGuard>
  );
}
