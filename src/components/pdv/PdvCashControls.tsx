import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { closeCashSession, getCashSessionSnapshot, recordCashMovement, type PosCashMovementType } from "@/lib/pos.functions";

export function PdvCashControls({
  sessionId, busy, onBusyChange, onClosed,
}: {
  sessionId: string;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onClosed: () => void;
}) {
  const moveCash = useServerFn(recordCashMovement);
  const closeCash = useServerFn(closeCashSession);
  const snapshotFn = useServerFn(getCashSessionSnapshot);
  const snapshotQuery = useQuery({
    queryKey: ["pdv-cash-snapshot", sessionId],
    queryFn: () => snapshotFn({ data: { sessionId } }),
    enabled: Boolean(sessionId),
  });
  const [type, setType] = useState<PosCashMovementType>("withdrawal");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [countedAmount, setCountedAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [showClose, setShowClose] = useState(false);

  function numberValue(value: string) {
    return Number(value.replace(",", "."));
  }

  async function submitMovement() {
    const parsed = numberValue(amount);
    if (!Number.isFinite(parsed) || !(parsed > 0) || reason.trim().length < 3) {
      toast.error("Informe valor e motivo com pelo menos 3 caracteres");
      return;
    }
    onBusyChange(true);
    try {
      await moveCash({ data: { sessionId, type, amount: parsed, reason: reason.trim() } });
      toast.success(type === "supply" ? "Suprimento registrado" : "Sangria registrada");
      await snapshotQuery.refetch();
      setAmount("");
      setReason("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao registrar movimento";
      toast.error(message.includes("INSUFFICIENT_CASH_DRAWER")
        ? "Sangria maior que o dinheiro disponível no caixa."
        : message);
    } finally {
      onBusyChange(false);
    }
  }

  async function submitClose() {
    const parsed = numberValue(countedAmount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Informe o dinheiro contado");
      return;
    }
    onBusyChange(true);
    try {
      const result: any = await closeCash({ data: {
        sessionId, countedAmount: parsed, notes: notes.trim() || undefined,
      } });
      const difference = Number(result?.difference_amount ?? 0);
      toast.success(`Caixa fechado · diferença: R$ ${difference.toFixed(2).replace(".", ",")}`);
      onClosed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao fechar caixa");
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      {snapshotQuery.data && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-background p-2 text-xs">
          <div><span className="text-muted-foreground">Dinheiro projetado</span><div className="font-bold">R$ {Number(snapshotQuery.data.expected_cash ?? 0).toFixed(2).replace(".", ",")}</div></div>
          <div><span className="text-muted-foreground">Vendas em dinheiro</span><div className="font-bold">R$ {Number(snapshotQuery.data.cash_sales ?? 0).toFixed(2).replace(".", ",")}</div></div>
          <div><span className="text-muted-foreground">Suprimentos</span><div>R$ {Number(snapshotQuery.data.supplies ?? 0).toFixed(2).replace(".", ",")}</div></div>
          <div><span className="text-muted-foreground">Sangrias</span><div>R$ {Number(snapshotQuery.data.withdrawals ?? 0).toFixed(2).replace(".", ",")}</div></div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Controle de caixa</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setShowClose((value) => !value)}>
          <LockKeyhole className="mr-1 h-4 w-4" /> Fechar caixa
        </Button>
      </div>
      {!showClose ? (
        <>
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <Select value={type} onValueChange={(value) => setType(value as PosCashMovementType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="withdrawal">Sangria</SelectItem>
                <SelectItem value="supply">Suprimento</SelectItem>
              </SelectContent>
            </Select>
            <Input inputMode="decimal" placeholder="Valor" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cash-reason">Motivo obrigatório</Label>
            <Input id="cash-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: retirada para cofre" />
          </div>
          <Button type="button" className="w-full" variant="outline" disabled={busy} onClick={submitMovement}>
            {type === "supply" ? <ArrowDownToLine className="mr-2 h-4 w-4" /> : <ArrowUpFromLine className="mr-2 h-4 w-4" />}
            Registrar {type === "supply" ? "suprimento" : "sangria"}
          </Button>
        </>
      ) : (
        <>
          <div>
            <Label htmlFor="counted-amount">Dinheiro contado no caixa</Label>
            <Input id="counted-amount" inputMode="decimal" value={countedAmount} onChange={(e) => setCountedAmount(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="closing-notes">Observações</Label>
            <Input id="closing-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
          <Button type="button" className="w-full" variant="destructive" disabled={busy} onClick={submitClose}>
            Confirmar fechamento
          </Button>
        </>
      )}
    </div>
  );
}
