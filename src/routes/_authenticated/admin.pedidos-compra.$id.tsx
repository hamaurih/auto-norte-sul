import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SupplyStatusBadge } from "@/components/admin/SupplyStatusBadge";
import { createGoodsReceipt, getPurchaseOrder, setPurchaseOrderStatus } from "@/lib/supplies.functions";
import { brl } from "@/lib/format";
import { formatDate, num, qty } from "@/lib/supplies-ui";
import { SupplyGuard } from "@/components/admin/SupplyGuard";

export const Route = createFileRoute("/_authenticated/admin/pedidos-compra/$id")({
  head: () => ({
    meta: [
      { title: "Pedido de compra · Admin" },
      { name: "description", content: "Detalhe do pedido de compra, aprovação e recebimento." },
    ],
  }),
  component: GuardedPedidoCompraDetailPage,
});

type ReceiveRow = {
  receivedPackages: string;
  rejectedPackages: string;
  unitsPerPackage: string;
  packageUnit: string;
  cost: string;
};

function PedidoCompraDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getPurchaseOrder);
  const statusFn = useServerFn(setPurchaseOrderStatus);
  const receiptFn = useServerFn(createGoodsReceipt);

  const [rows, setRows] = useState<Record<string, ReceiveRow>>({});
  const [invoice, setInvoice] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptNotes, setReceiptNotes] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["purchase-order", id],
    queryFn: () => getFn({ data: { id } }),
  });

  const order = data?.order as any;
  const items = (data?.items ?? []) as any[];
  const receipts = (data?.receipts ?? []) as any[];

  const canReceive = order && ["approved", "sent", "partially_received"].includes(order.status);

  const pendingItems = useMemo(
    () => items.filter((item) => num(item.ordered_qty) - num(item.received_qty) > 0),
    [items],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["purchase-order", id] });
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["supplies-overview"] });
  };

  const changeStatus = useMutation({
    mutationFn: (input: { status: "approved" | "sent" | "cancelled"; reason?: string }) =>
      statusFn({ data: { id, ...input } }),
    onSuccess: () => {
      toast.success("Status atualizado");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createReceipt = useMutation({
    mutationFn: () =>
      receiptFn({
        data: {
          purchase_order_id: id,
          received_at: receivedAt,
          invoice_number: invoice || null,
          notes: receiptNotes || null,
          items: pendingItems
            .map((item) => {
              const row = rows[item.id];
              const receivedPackages = num(row?.receivedPackages?.replace(",", "."));
              const rejectedPackages = num(row?.rejectedPackages?.replace(",", "."));
              const unitsPerPackage = num(row?.unitsPerPackage?.replace(",", "."));
              const acceptedUnits = Math.max(0, (receivedPackages - rejectedPackages) * unitsPerPackage);
              const rejectedUnits = Math.max(0, rejectedPackages * unitsPerPackage);
              return {
                purchase_order_item_id: item.id as string,
                accepted_qty: acceptedUnits,
                rejected_qty: rejectedUnits,
                received_package_qty: receivedPackages,
                rejected_package_qty: rejectedPackages,
                units_per_package: unitsPerPackage,
                package_unit: row?.packageUnit?.trim().toUpperCase() || "UN",
                unit_cost: row?.cost ? num(row.cost.replace(",", ".")) : num(item.unit_cost),
              };
            })
            .filter((row) => row.received_package_qty > 0 || row.rejected_package_qty > 0),
        },
      }),
    onSuccess: (result) => {
      toast.success(`Recebimento #${result.number} criado para conferência`);
      void navigate({ to: "/admin/recebimentos/$id", params: { id: result.id } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando pedido…</p>;
  if (isError || !order) {
    return (
      <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
        {(error as Error)?.message ?? "Pedido de compra não encontrado."}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase">
            Pedido #{order.number} <SupplyStatusBadge status={order.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.supplier?.legal_name} · {order.warehouse?.name} · emitido {formatDate(order.issued_at)} ·
            previsão {formatDate(order.expected_at)}
          </p>
          {order.cancel_reason && (
            <p className="mt-1 text-sm text-destructive">Cancelado: {order.cancel_reason}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {order.status === "draft" && (
            <Button variant="outline" asChild>
              <Link to="/admin/pedidos-compra/editar/$id" params={{ id }}>
                Editar
              </Link>
            </Button>
          )}
          {order.status === "draft" && (
            <Button disabled={changeStatus.isPending} onClick={() => changeStatus.mutate({ status: "approved" })}>
              Aprovar
            </Button>
          )}
          {order.status === "approved" && (
            <Button onClick={() => changeStatus.mutate({ status: "sent" })}>Marcar como enviado</Button>
          )}
          {["draft", "approved", "sent"].includes(order.status) && (
            <Button
              variant="outline"
              onClick={() => {
                const reason = prompt("Motivo do cancelamento:");
                if (reason?.trim()) changeStatus.mutate({ status: "cancelled", reason });
              }}
            >
              Cancelar pedido
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/admin/pedidos-compra">Voltar</Link>
          </Button>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-lg font-bold">Itens do pedido</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 text-left">Produto</th>
                <th className="py-1 text-right">Pedido</th>
                <th className="py-1 text-right">Recebido</th>
                <th className="py-1 text-right">Custo</th>
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
                  <td className="py-1.5 text-right">{qty(item.ordered_qty)}</td>
                  <td className="py-1.5 text-right">{qty(item.received_qty)}</td>
                  <td className="py-1.5 text-right">{brl(num(item.unit_cost))}</td>
                  <td className="py-1.5 text-right">{brl(num(item.line_total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-4 text-sm">
          <span className="text-muted-foreground">Itens {brl(num(order.items_total))}</span>
          <span className="text-muted-foreground">Frete {brl(num(order.freight_amount))}</span>
          <span className="text-muted-foreground">Desconto {brl(num(order.discount_amount))}</span>
          <span className="font-display text-lg font-bold">{brl(num(order.total_amount))}</span>
        </div>
      </section>

      {canReceive && pendingItems.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold">Registrar recebimento</h2>
          <p className="text-xs text-muted-foreground">
            Confira por SKU, informe quantidade aceita/recusada e o custo efetivo. O estoque só é atualizado
            quando o recebimento for confirmado.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
            <Input
              placeholder="Nota fiscal"
              value={invoice}
              onChange={(event) => setInvoice(event.target.value)}
            />
          </div>

          <div className="mt-3 space-y-2">
            <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-900">
              Informe a quantidade física na embalagem. Exemplo: <strong>100 CX × 10 UN = 1.000 UN</strong>.
              O estoque será atualizado apenas com a quantidade-base convertida.
            </div>
            {pendingItems.map((item) => {
              const pending = num(item.ordered_qty) - num(item.received_qty);
              const row = rows[item.id] ?? {
                receivedPackages: "",
                rejectedPackages: "",
                unitsPerPackage: "1",
                packageUnit: "UN",
                cost: String(num(item.unit_cost)),
              };
              const receivedPackages = num(row.receivedPackages.replace(",", "."));
              const rejectedPackages = num(row.rejectedPackages.replace(",", "."));
              const unitsPerPackage = num(row.unitsPerPackage.replace(",", "."));
              const acceptedUnits = Math.max(0, (receivedPackages - rejectedPackages) * unitsPerPackage);
              const update = (patch: Partial<ReceiveRow>) =>
                setRows((current) => ({ ...current, [item.id]: { ...row, ...patch } }));
              return (
                <div
                  key={item.id}
                  className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_100px_100px_90px_78px_110px] sm:items-end"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{item.product?.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.product?.sku} · pendente {qty(pending)} UN
                    </div>
                  </div>
                  <label className="text-xs font-semibold">
                    Recebidas
                    <Input
                      aria-label={`Embalagens recebidas de ${item.product?.sku}`}
                      placeholder="Ex.: 100"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={row.receivedPackages}
                      onChange={(event) => update({ receivedPackages: event.target.value })}
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    Recusadas
                    <Input
                      aria-label={`Embalagens recusadas de ${item.product?.sku}`}
                      placeholder="Ex.: 0"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={row.rejectedPackages}
                      onChange={(event) => update({ rejectedPackages: event.target.value })}
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    Por embalagem
                    <Input
                      aria-label={`Unidades por embalagem de ${item.product?.sku}`}
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={row.unitsPerPackage}
                      onChange={(event) => update({ unitsPerPackage: event.target.value })}
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    Unidade
                    <select
                      aria-label={`Unidade da embalagem de ${item.product?.sku}`}
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={row.packageUnit}
                      onChange={(event) => update({ packageUnit: event.target.value })}
                    >
                      <option value="UN">UN</option>
                      <option value="CX">CX</option>
                      <option value="FD">FD</option>
                      <option value="KIT">KIT</option>
                      <option value="PCT">PCT</option>
                      <option value="PAR">PAR</option>
                      <option value="JOGO">JOGO</option>
                      <option value="MIL">MIL</option>
                    </select>
                  </label>
                  <div className="text-xs font-semibold">
                    <span className="block">Aceito (UN)</span>
                    <span className="mt-1 flex h-10 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 text-sm font-bold text-emerald-800">
                      {acceptedUnits}
                    </span>
                  </div>
                  <label className="text-xs font-semibold sm:col-span-2">
                    Custo efetivo por unidade-base
                    <Input
                      aria-label={`Custo efetivo por unidade de ${item.product?.sku}`}
                      placeholder="Custo"
                      inputMode="decimal"
                      value={row.cost}
                      onChange={(event) => update({ cost: event.target.value })}
                    />
                  </label>
                </div>
              );
            })}
          </div>

          <Textarea
            className="mt-2"
            placeholder="Observações do recebimento"
            value={receiptNotes}
            onChange={(event) => setReceiptNotes(event.target.value)}
          />

          <div className="mt-3 flex justify-end">
            <Button disabled={createReceipt.isPending} onClick={() => createReceipt.mutate()}>
              Criar conferência de recebimento
            </Button>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-lg font-bold">Recebimentos deste pedido</h2>
        {receipts.length === 0 && <p className="mt-1 text-sm text-muted-foreground">Nenhum recebimento ainda.</p>}
        <ul className="mt-2 space-y-1">
          {receipts.map((receipt) => (
            <li key={receipt.id}>
              <Link
                to="/admin/recebimentos/$id"
                params={{ id: receipt.id }}
                className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-border hover:bg-muted"
              >
                <span>
                  #{receipt.number} · {formatDate(receipt.received_at)}
                  {receipt.invoice_number ? ` · NF ${receipt.invoice_number}` : ""}
                </span>
                <SupplyStatusBadge status={receipt.status} kind="receipt" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function GuardedPedidoCompraDetailPage() {
  return (
    <SupplyGuard>
      <PedidoCompraDetailPage />
    </SupplyGuard>
  );
}
