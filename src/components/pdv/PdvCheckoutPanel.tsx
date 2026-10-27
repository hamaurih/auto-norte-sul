import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PdvCashControls } from "@/components/pdv/PdvCashControls";
import {
  finalizePosSale, getOpenCashSession, openCashSession, type PosPaymentMethod,
} from "@/lib/pos.functions";

type Item = { id: string; name: string; quantity: number; unitPrice: number };
type Warehouse = { id: string; branch_id: string; name: string; code: string };
type Payment = {
  method: PosPaymentMethod;
  amount: number;
  installments: number;
  provider?: string;
  provider_reference?: string;
};

const paymentLabels: Record<PosPaymentMethod, string> = {
  cash: "Dinheiro", pix: "Pix", debit_card: "Débito", credit_card: "Crédito",
  store_credit: "Crediário", b2b_invoice: "Faturado B2B",
};

export function PdvCheckoutPanel({
  warehouse, items, total, onCompleted,
}: { warehouse: Warehouse | null; items: Item[]; total: number; onCompleted: (saleId: string) => void }) {
  const getSession = useServerFn(getOpenCashSession);
  const openSession = useServerFn(openCashSession);
  const finishSale = useServerFn(finalizePosSale);
  const [terminalCode, setTerminalCode] = useState("CAIXA-01");
  const [openingAmount, setOpeningAmount] = useState("0");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [method, setMethod] = useState<PosPaymentMethod>("cash");
  const [amount, setAmount] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reference, setReference] = useState("");
  const [installments, setInstallments] = useState(1);
  const [busy, setBusy] = useState(false);

  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);

  async function ensureCashSession() {
    if (!warehouse) {
      toast.error("Selecione um depósito");
      return;
    }
    const normalizedTerminal = terminalCode.trim().toUpperCase();
    const parsedOpening = Number(openingAmount.replace(",", "."));
    if (!normalizedTerminal) {
      toast.error("Informe o terminal do caixa");
      return;
    }
    if (!Number.isFinite(parsedOpening) || parsedOpening < 0) {
      toast.error("O fundo de caixa deve ser zero ou um valor positivo");
      return;
    }
    setBusy(true);
    try {
      const current: any = await getSession({ data: { terminalCode: normalizedTerminal } });
      if (current?.id) {
        if (current.warehouse_id !== warehouse.id) {
          throw new Error("Este terminal está aberto em outro depósito. Feche o caixa anterior ou use outro terminal.");
        }
        setSessionId(current.id);
      } else {
        const opened: any = await openSession({ data: {
          branchId: warehouse.branch_id, warehouseId: warehouse.id, terminalCode: normalizedTerminal,
          openingAmount: Math.round(parsedOpening * 100) / 100,
        } });
        setSessionId(opened?.id ?? null);
      }
      toast.success("Caixa aberto e pronto para vender");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir o caixa");
    } finally { setBusy(false); }
  }

  function addPayment() {
    const parsed = Number(amount.replace(",", "."));
    const value = parsed > 0 ? parsed : remaining;
    if (value <= 0 || value > remaining + 0.001) {
      toast.error("Informe um valor válido");
      return;
    }

    const electronic = ["pix", "debit_card", "credit_card"].includes(method);
    const providerReference = reference.trim();
    if (electronic && !providerReference) {
      toast.error("Informe o NSU/ID da transação eletrônica.");
      return;
    }

    setPayments((rows) => [...rows, {
      method,
      amount: Math.round(value * 100) / 100,
      installments: method === "credit_card" ? installments : 1,
      provider_reference: providerReference || undefined,
    }]);
    setAmount("");
    setReference("");
    setInstallments(1);
  }

  async function finalize() {
    if (!sessionId || items.length === 0 || Math.abs(paid - total) > 0.001) return;
    setBusy(true);
    try {
      const result = await finishSale({ data: {
        cashSessionId: sessionId, idempotencyKey: crypto.randomUUID(),
        items: items.map((item) => ({ product_id: item.id, quantity: item.quantity })),
        payments, discountAmount: 0,
      } });
      toast.success(
        `Venda PDV #${result.saleId.slice(0, 8)}${result.orderId ? ` · Pedido ERP #${result.orderId.slice(0, 8)}` : ""}`,
      );
      setPayments([]);
      onCompleted(result.saleId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao concluir venda";
      toast.error(message.includes("INSUFFICIENT_STOCK") ? "Estoque mudou. Atualize o carrinho." : message);
    } finally { setBusy(false); }
  }

  if (!sessionId) return (
    <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-3">
      <p className="text-sm font-semibold">Abrir caixa para iniciar</p>
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor="terminal">Terminal</Label><Input id="terminal" value={terminalCode} onChange={(e) => setTerminalCode(e.target.value.toUpperCase())} /></div>
        <div><Label htmlFor="opening">Fundo de caixa</Label><Input id="opening" inputMode="decimal" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} /></div>
      </div>
      <Button className="w-full" disabled={!warehouse || busy || !terminalCode.trim()} onClick={ensureCashSession}>
        {busy ? "Abrindo…" : "Abrir caixa"}
      </Button>
    </div>
  );

  return (
    <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-green-700">● {terminalCode} aberto</span>
        <span>Falta: R$ {remaining.toFixed(2).replace(".", ",")}</span>
      </div>
      <div className="grid gap-2">
        <div className="grid grid-cols-[1fr_110px_auto] gap-2">
          <Select value={method} onValueChange={(v) => {
            setMethod(v as PosPaymentMethod);
            setReference("");
            setInstallments(1);
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(paymentLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Input inputMode="decimal" placeholder={remaining.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button type="button" variant="outline" onClick={addPayment} disabled={remaining <= 0}>Adicionar</Button>
        </div>

        {["pix", "debit_card", "credit_card"].includes(method) && (
          <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
            <div>
              <Label htmlFor="payment-reference">NSU / ID da transação</Label>
              <Input
                id="payment-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Obrigatório para pagamento eletrônico"
              />
            </div>
            {method === "credit_card" ? (
              <div>
                <Label>Parcelas</Label>
                <Select value={String(installments)} onValueChange={(value) => setInstallments(Number(value))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5,6].map((count) => <SelectItem key={count} value={String(count)}>{count}x</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : <div />}
          </div>
        )}
      </div>
      {payments.length > 0 && <div className="space-y-1 text-xs">{payments.map((p, i) => (
        <button key={i} type="button" className="flex w-full justify-between rounded border px-2 py-1 hover:bg-destructive/5" onClick={() => setPayments((rows) => rows.filter((_, index) => index !== i))}>
          <span>
            {paymentLabels[p.method]}
            {p.installments > 1 ? ` · ${p.installments}x` : ""}
            {p.provider_reference ? ` · ${p.provider_reference}` : ""}
          </span>
          <span>R$ {p.amount.toFixed(2).replace(".", ",")} · remover</span>
        </button>
      ))}</div>}
      <Button className="w-full" size="lg" disabled={busy || items.length === 0 || Math.abs(paid - total) > 0.001} onClick={finalize}>
        {busy ? "Finalizando…" : "Concluir venda"}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">Preço, venda e estoque são confirmados pelo servidor.</p>
      <PdvCashControls sessionId={sessionId} busy={busy} onBusyChange={setBusy} onClosed={() => {
        setSessionId(null);
        setPayments([]);
      }} />
    </div>
  );
}
