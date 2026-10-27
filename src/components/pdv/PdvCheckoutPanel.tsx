import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, RefreshCcw, Trash2 } from "lucide-react";
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
type PendingSale = {
  cashSessionId: string;
  idempotencyKey: string;
  items: Array<{ product_id: string; quantity: number }>;
  payments: Payment[];
  discountAmount: number;
  total: number;
  createdAt: string;
};

const PENDING_SALE_KEY = "norte-sul:pdv:pending-sale:v1";

const paymentLabels: Record<PosPaymentMethod, string> = {
  cash: "Dinheiro", pix: "Pix", debit_card: "Débito", credit_card: "Crédito",
  store_credit: "Crediário", b2b_invoice: "Faturado B2B",
};

function needsReference(method: PosPaymentMethod) {
  return method === "pix" || method === "debit_card" || method === "credit_card";
}

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
  const [provider, setProvider] = useState("manual");
  const [providerReference, setProviderReference] = useState("");
  const [installments, setInstallments] = useState("1");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pendingSale, setPendingSale] = useState<PendingSale | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PENDING_SALE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PendingSale;
      if (parsed?.idempotencyKey && Array.isArray(parsed.items) && Array.isArray(parsed.payments)) {
        setPendingSale(parsed);
      }
    } catch {
      window.localStorage.removeItem(PENDING_SALE_KEY);
    }
  }, []);

  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);

  function persistPending(payload: PendingSale) {
    window.localStorage.setItem(PENDING_SALE_KEY, JSON.stringify(payload));
    setPendingSale(payload);
  }

  function clearPending() {
    window.localStorage.removeItem(PENDING_SALE_KEY);
    setPendingSale(null);
  }

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
    } finally {
      setBusy(false);
    }
  }

  function addPayment() {
    const parsed = Number(amount.replace(",", "."));
    const value = parsed > 0 ? parsed : remaining;
    const parsedInstallments = Math.max(1, Math.min(24, Math.trunc(Number(installments) || 1)));

    if (value <= 0 || value > remaining + 0.001) {
      toast.error("Informe um valor válido");
      return;
    }
    if (needsReference(method) && providerReference.trim().length < 3) {
      toast.error("Informe a referência/autorização da transação");
      return;
    }

    setPayments((rows) => [...rows, {
      method,
      amount: Math.round(value * 100) / 100,
      installments: method === "credit_card" ? parsedInstallments : 1,
      provider: needsReference(method) ? provider.trim() || "manual" : undefined,
      provider_reference: needsReference(method) ? providerReference.trim() : undefined,
    }]);
    setAmount("");
    setProviderReference("");
    setInstallments("1");
  }

  async function submitSale(payload: PendingSale) {
    const result = await finishSale({ data: {
      cashSessionId: payload.cashSessionId,
      idempotencyKey: payload.idempotencyKey,
      items: payload.items,
      payments: payload.payments,
      discountAmount: payload.discountAmount,
    } });
    clearPending();
    setPayments([]);
    toast.success("Venda concluída #" + result.saleId.slice(0, 8));
    onCompleted(result.saleId);
  }

  async function finalize() {
    if (!sessionId || items.length === 0 || Math.abs(paid - total) > 0.001) return;
    const payload: PendingSale = {
      cashSessionId: sessionId,
      idempotencyKey: crypto.randomUUID(),
      items: items.map((item) => ({ product_id: item.id, quantity: item.quantity })),
      payments,
      discountAmount: 0,
      total,
      createdAt: new Date().toISOString(),
    };

    persistPending(payload);
    setBusy(true);
    try {
      await submitSale(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao concluir venda";
      toast.error(
        message.includes("INSUFFICIENT_STOCK")
          ? "Estoque mudou. A tentativa ficou salva para conferência."
          : "Não foi possível confirmar a venda. A tentativa ficou salva para recuperação.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryPending() {
    if (!pendingSale) return;
    setBusy(true);
    try {
      await submitSale(pendingSale);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao recuperar venda";
      toast.error(message.includes("CASH_SESSION_NOT_OPEN")
        ? "A tentativa não foi concluída e o caixa original está fechado. Confira antes de descartar."
        : message);
    } finally {
      setBusy(false);
    }
  }

  if (!sessionId) return (
    <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-3">
      {pendingSale && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              <p className="font-semibold">Existe uma venda pendente de confirmação.</p>
              <p className="text-xs">Abra o caixa e use a recuperação para reenviar a mesma tentativa sem duplicar a venda.</p>
            </div>
          </div>
        </div>
      )}
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
      {pendingSale && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              <p className="font-semibold">Venda pendente de confirmação</p>
              <p className="text-xs">
                Total R$ {Number(pendingSale.total).toFixed(2).replace(".", ",")} · tentativa preservada para evitar duplicidade.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={retryPending}>
              <RefreshCcw className="mr-1 h-4 w-4" /> Verificar novamente
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Descarte somente se você já conferiu que a venda não foi concluída.")) clearPending();
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Descartar
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-green-700">● {terminalCode} aberto</span>
        <span>Falta: R$ {remaining.toFixed(2).replace(".", ",")}</span>
      </div>

      <div className="grid grid-cols-[1fr_110px_auto] gap-2">
        <Select value={method} onValueChange={(v) => setMethod(v as PosPaymentMethod)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(paymentLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Input inputMode="decimal" placeholder={remaining.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button type="button" variant="outline" onClick={addPayment} disabled={remaining <= 0}>Adicionar</Button>
      </div>

      {needsReference(method) && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_90px]">
          <div>
            <Label htmlFor="payment-provider">Operadora</Label>
            <Input id="payment-provider" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Stone, Cielo…" />
          </div>
          <div>
            <Label htmlFor="payment-reference">Autorização / referência</Label>
            <Input id="payment-reference" value={providerReference} onChange={(e) => setProviderReference(e.target.value)} placeholder="NSU, E2E, autorização…" />
          </div>
          {method === "credit_card" ? (
            <div>
              <Label htmlFor="installments">Parcelas</Label>
              <Input id="installments" type="number" min={1} max={24} value={installments} onChange={(e) => setInstallments(e.target.value)} />
            </div>
          ) : <div />}
        </div>
      )}

      {payments.length > 0 && (
        <div className="space-y-1 text-xs">
          {payments.map((p, i) => (
            <button
              key={i}
              type="button"
              className="flex w-full justify-between rounded border px-2 py-1 hover:bg-destructive/5"
              onClick={() => setPayments((rows) => rows.filter((_, index) => index !== i)}
            >
              <span>
                {paymentLabels[p.method]}
                {p.method === "credit_card" && p.installments > 1 ? " · " + p.installments + "x" : ""}
                {p.provider_reference ? " · ref. " + p.provider_reference : ""}
              </span>
              <span>R$ {p.amount.toFixed(2).replace(".", ",")} · remover</span>
            </button>
          ))}
        </div>
      )}

      <Button
        className="w-full"
        size="lg"
        disabled={busy || Boolean(pendingSale) || items.length === 0 || Math.abs(paid - total) > 0.001}
        onClick={finalize}
      >
        {busy ? "Finalizando…" : "Concluir venda"}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        Preço, estoque e pagamentos são confirmados pelo servidor. Em interrupção, a mesma tentativa é recuperada por idempotência.
      </p>
      <PdvCashControls sessionId={sessionId} busy={busy} onBusyChange={setBusy} onClosed={() => {
        setSessionId(null);
        setPayments([]);
      }} />
    </div>
  );
}
