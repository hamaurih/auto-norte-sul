import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Ban, Printer } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { brl } from "@/lib/format";
import {
  cancelPosSale,
  getPosCompanyHeader,
  getPosSaleDetail,
  type PosSaleDetail,
} from "@/lib/pos-history.functions";
import { PdvReceipt, paymentLabel, printReceipt } from "@/components/pdv/PdvReceipt";

export const statusLabels: Record<string, string> = {
  completed: "Concluída",
  cancelled: "Cancelada",
  refunded: "Estornada",
  pending: "Pendente",
};

export function statusVariant(status: string) {
  if (status === "cancelled" || status === "refunded") return "destructive" as const;
  if (status === "completed") return "secondary" as const;
  return "outline" as const;
}

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function PdvSaleDetailSheet({
  saleId,
  canCancel,
  onOpenChange,
  onCancelled,
}: {
  saleId: string | null;
  canCancel: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled: () => void;
}) {
  const queryClient = useQueryClient();
  const detailFn = useServerFn(getPosSaleDetail);
  const companyFn = useServerFn(getPosCompanyHeader);
  const cancelFn = useServerFn(cancelPosSale);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["pdv-sale", saleId],
    enabled: Boolean(saleId),
    queryFn: () => detailFn({ data: { saleId: saleId as string } }) as Promise<PosSaleDetail>,
  });

  const companyQuery = useQuery({
    queryKey: ["pdv-company-header"],
    queryFn: () => companyFn(),
    staleTime: 300_000,
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelFn({ data: { saleId: saleId as string, reason: reason.trim() } }),
    onSuccess: (result: any) => {
      toast.success("Venda cancelada e estoque reposto");
      for (const warning of (result?.warnings ?? []) as string[]) {
        toast.warning(warning, { duration: 9000 });
      }
      setReason("");
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["pdv-sale", saleId] });
      queryClient.invalidateQueries({ queryKey: ["pdv-sales"] });
      queryClient.invalidateQueries({ queryKey: ["pdv-cash-report"] });
      queryClient.invalidateQueries({ queryKey: ["pdv-products"] });
      onCancelled();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Falha ao cancelar a venda");
      setConfirmOpen(false);
    },
  });

  const sale = detailQuery.data ?? null;
  const cancelled = Boolean(sale?.cancelled_at);
  const reasonValid = reason.trim().length >= 5;

  return (
    <>
      <Sheet open={Boolean(saleId)} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="font-display uppercase">
              Venda {sale?.code ?? ""}
            </SheetTitle>
            <SheetDescription>Detalhe completo da venda de balcão.</SheetDescription>
          </SheetHeader>

          {detailQuery.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : detailQuery.isError || !sale ? (
            <div className="p-4 text-sm text-destructive">
              Não foi possível carregar esta venda.
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(sale.status)}>
                  {statusLabels[sale.status] ?? sale.status}
                </Badge>
                <span className="text-sm text-muted-foreground">{dateTime(sale.created_at)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => printReceipt()}
                >
                  <Printer className="mr-1 h-4 w-4" /> Imprimir comprovante
                </Button>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Operador</dt>
                  <dd>{sale.operator_name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Terminal</dt>
                  <dd>{sale.terminal_code || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Depósito</dt>
                  <dd>{sale.warehouse_name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Cliente</dt>
                  <dd>{sale.customer_name || "Consumidor não identificado"}</dd>
                </div>
                {sale.fiscal_status ? (
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Situação fiscal</dt>
                    <dd>{sale.fiscal_status}</dd>
                  </div>
                ) : null}
              </dl>

              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Itens</p>
                {sale.items.map((item) => (
                  <div key={item.id} className="rounded-lg border p-3 text-sm">
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-muted-foreground">SKU {item.sku ?? "—"}</p>
                    <div className="mt-1 flex justify-between">
                      <span>
                        {item.quantity} x {brl(item.unit_price)}
                      </span>
                      <span className="font-semibold">{brl(item.line_total)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <Separator />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{brl(sale.subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Desconto</span>
                  <span>{brl(sale.discount_amount)}</span>
                </div>
                <div className="flex justify-between font-display text-xl font-black">
                  <span>Total</span>
                  <span>{brl(sale.total)}</span>
                </div>
              </div>

              <Separator />
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Pagamentos</p>
                {sale.payments.map((payment) => (
                  <div key={payment.id} className="flex justify-between text-sm">
                    <span>
                      {paymentLabel(payment.method)}
                      {payment.installments && payment.installments > 1
                        ? ` · ${payment.installments}x`
                        : ""}
                      {payment.provider ? ` · ${payment.provider}` : ""}
                    </span>
                    <span>{brl(payment.amount)}</span>
                  </div>
                ))}
              </div>

              {cancelled ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p className="font-semibold">Venda cancelada em {dateTime(sale.cancelled_at)}</p>
                  <p className="text-muted-foreground">
                    Motivo: {sale.cancel_reason || "não registrado"}
                  </p>
                </div>
              ) : canCancel ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <Label htmlFor="cancel-reason" className="text-xs uppercase">
                    Motivo do cancelamento (mínimo 5 caracteres)
                  </Label>
                  <Textarea
                    id="cancel-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Ex.: cliente desistiu da compra"
                  />
                  <Button
                    variant="destructive"
                    disabled={!reasonValid || cancelMutation.isPending}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Ban className="mr-1 h-4 w-4" /> Cancelar venda
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  Cancelamento restrito a proprietário, administrador ou gerente.
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar cancelamento da venda {sale?.code}</AlertDialogTitle>
            <AlertDialogDescription>
              O estoque dos itens será reposto e a venda deixará de contar no caixa. Esta ação não
              pode ser desfeita. Motivo: “{reason.trim()}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                cancelMutation.mutate();
              }}
            >
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PdvReceipt sale={sale} company={(companyQuery.data as any) ?? null} />
    </>
  );
}
