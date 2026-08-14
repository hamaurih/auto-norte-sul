import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SupplyStatusBadge } from "@/components/admin/SupplyStatusBadge";
import { confirmGoodsReceipt, getGoodsReceipt, reverseGoodsReceipt } from "@/lib/supplies.functions";
import { brl } from "@/lib/format";
import { formatDate, num, qty } from "@/lib/supplies-ui";

export const Route = createFileRoute("/_authenticated/admin/recebimentos/$id")({
  head: () => ({
    meta: [
      { title: "Recebimento · Admin" },
      { name: "description", content: "Conferência, confirmação e estorno de recebimento de mercadoria." },
    ],
  }),
  component: RecebimentoDetailPage,
});

function RecebimentoDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getGoodsReceipt);
  const confirmFn = useServerFn(confirmGoodsReceipt);
  const reverseFn = useServerFn(reverseGoodsReceipt);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["goods-receipt", id],
    queryFn: () => getFn({ data: { id } }),
  });

  const receipt = data?.receipt as any;
  const items = (data?.items ?? []) as any[];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["goods-receipt", id] });
    qc.invalidateQueries({ queryKey: ["goods-receipts"] });
    qc.invalidateQueries({ queryKey: ["purchase-order"] });
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["supplies-overview"] });
  };

  const confirm = useMutation({
    mutationFn: () => confirmFn({ data: { id } }),
    onSuccess: (result) => {
      toast.success(
        result?.already_confirmed
          ? "Recebimento já estava confirmado — nada foi duplicado"
          : "Recebimento confirmado: estoque e custo atualizados",
      );
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reverse = useMutation({
    mutationFn: (reason: string) => reverseFn({ data: { id, reason } }),
    onSuccess: () => {
      toast.success("Recebimento estornado");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando recebimento…</p>;
  if (isError || !receipt) {
    return (
      <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
        {(error as Error)?.message ?? "Recebimento não encontrado."}
      </div>
    );
  }

  const total = items.reduce((sum, item) => sum + num(item.accepted_qty) * num(item.unit_cost), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase">
            Recebimento #{receipt.number} <SupplyStatusBadge status={receipt.status} kind="receipt" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {receipt.supplier?.legal_name} · {receipt.warehouse?.name} · {formatDate(receipt.received_at)}
            {receipt.invoice_number ? ` · NF ${receipt.invoice_number}` : ""}
          </p>
          <p className="mt-1 text-sm">
            <Link
              to="/admin/pedidos-compra/$id"
              params={{ id: receipt.purchase_order_id }}
              className="font-semibold text-primary hover:underline"
            >
              Pedido de compra #{receipt.purchase_order?.number}
            </Link>
          </p>
          {receipt.reverse_reason && (
            <p className="mt-1 text-sm text-destructive">Estornado: {receipt.reverse_reason}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {receipt.status === "draft" && (
            <Button disabled={confirm.isPending} onClick={() => confirm.mutate()}>
              Confirmar entrada no estoque
            </Button>
          )}
          {receipt.status === "confirmed" && (
            <Button
              variant="outline"
              disabled={reverse.isPending}
              onClick={() => {
                const reason = prompt("Motivo do estorno:");
                if (reason?.trim()) reverse.mutate(reason);
              }}
            >
              Estornar recebimento
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/admin/recebimentos">Voltar</Link>
          </Button>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-lg font-bold">Itens conferidos</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 text-left">Produto</th>
                <th className="py-1 text-right">Aceito</th>
                <th className="py-1 text-right">Recusado</th>
                <th className="py-1 text-right">Custo efetivo</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="py-1.5">
                    <div className="font-semibold">{item.product?.name}</div>
                    <div className="text-xs text-muted-foreground">{item.product?.sku}</div>
                  </td>
                  <td className="py-1.5 text-right">{qty(item.accepted_qty)}</td>
                  <td className="py-1.5 text-right">{qty(item.rejected_qty)}</td>
                  <td className="py-1.5 text-right">{brl(num(item.unit_cost))}</td>
                  <td className="py-1.5 text-right">
                    {brl(num(item.accepted_qty) * num(item.unit_cost))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-right font-display text-lg font-bold">{brl(total)}</div>
        {receipt.notes && <p className="mt-2 text-sm text-muted-foreground">{receipt.notes}</p>}
      </section>

      {receipt.status === "draft" && (
        <p className="text-xs text-muted-foreground">
          Enquanto o recebimento estiver em conferência, nenhum saldo de estoque ou custo é alterado. A
          confirmação é idempotente: reenviar não duplica entradas.
        </p>
      )}
    </div>
  );
}
