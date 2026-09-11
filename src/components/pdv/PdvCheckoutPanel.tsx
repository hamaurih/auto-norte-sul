import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Banknote,
  CreditCard,
  FileText,
  Loader2,
  QrCode,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PdvCashControls } from "@/components/pdv/PdvCashControls";
import { PdvConnectionStatus } from "@/components/pdv/PdvConnectionStatus";
import {
  finalizePosSale,
  getOpenCashSession,
  openCashSession,
  type PosPaymentMethod,
} from "@/lib/pos.functions";
import {
  enqueuePendingPosSale,
  getPosLocalValue,
  isLikelyNetworkError,
  listPendingPosSales,
  markPendingPosSaleFailure,
  removePendingPosSale,
  setPosLocalValue,
} from "@/lib/pos-offline";
import {
  isStonePaymentAvailable,
  requestStonePayment,
} from "@/lib/pos-device";

type Item = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

type Warehouse = {
  id: string;
  branch_id: string;
  name: string;
  code: string;
};

type Payment = {
  method: PosPaymentMethod;
  amount: number;
  installments: number;
  provider?: string;
  provider_reference?: string;
};

type PersistedSession = {
  terminalCode: string;
  sessionId: string;
  warehouseId: string;
};

const paymentLabels: Record<
  PosPaymentMethod,
  string
> = {
  cash: "Dinheiro",
  pix: "Pix",
  debit_card: "Débito",
  credit_card: "Crédito",
  store_credit: "Crediário",
  b2b_invoice: "Faturado B2B",
};

const methods: Array<{
  value: PosPaymentMethod;
  label: string;
  icon: typeof Banknote;
}> = [
  {
    value: "cash",
    label: "Dinheiro",
    icon: Banknote,
  },
  {
    value: "pix",
    label: "Pix",
    icon: QrCode,
  },
  {
    value: "debit_card",
    label: "Débito",
    icon: CreditCard,
  },
  {
    value: "credit_card",
    label: "Crédito",
    icon: WalletCards,
  },
  {
    value: "store_credit",
    label: "Crediário",
    icon: ReceiptText,
  },
  {
    value: "b2b_invoice",
    label: "Faturado",
    icon: FileText,
  },
];

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const SESSION_CACHE_KEY = "pdv:active-session";

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function PdvCheckoutPanel({
  warehouse,
  items,
  total,
  onCompleted,
}: {
  warehouse: Warehouse | null;
  items: Item[];
  total: number;
  onCompleted: (saleId: string) => void;
}) {
  const getSession = useServerFn(
    getOpenCashSession,
  );
  const openSession = useServerFn(openCashSession);
  const finishSale = useServerFn(finalizePosSale);

  const [terminalCode, setTerminalCode] =
    useState("CAIXA-01");
  const [openingAmount, setOpeningAmount] =
    useState("0");
  const [sessionId, setSessionId] = useState<
    string | null
  >(null);
  const [method, setMethod] =
    useState<PosPaymentMethod>("cash");
  const [amount, setAmount] = useState("");
  const [installments, setInstallments] =
    useState("1");
  const [
    externalReference,
    setExternalReference,
  ] = useState("");
  const [payments, setPayments] = useState<
    Payment[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [changeDue, setChangeDue] = useState(0);
  const [idempotencyKey, setIdempotencyKey] =
    useState(() => crypto.randomUUID());

  const paid = useMemo(
    () =>
      roundMoney(
        payments.reduce(
          (sum, payment) =>
            sum + payment.amount,
          0,
        ),
      ),
    [payments],
  );

  const remaining = Math.max(
    0,
    roundMoney(total - paid),
  );

  const stoneAvailable =
    isStonePaymentAvailable();

  useEffect(() => {
    if (!warehouse) return;

    void getPosLocalValue<PersistedSession>(
      SESSION_CACHE_KEY,
    ).then((cached) => {
      if (
        !cached ||
        cached.warehouseId !== warehouse.id
      ) {
        return;
      }

      setTerminalCode(
        cached.terminalCode || "CAIXA-01",
      );
      setSessionId(cached.sessionId || null);
    });
  }, [warehouse?.id]);

  useEffect(() => {
    const onOnline = () =>
      void syncPendingSales();

    window.addEventListener("online", onOnline);
    return () =>
      window.removeEventListener(
        "online",
        onOnline,
      );
  });

  async function ensureCashSession() {
    if (!warehouse) {
      toast.error("Selecione um depósito");
      return;
    }

    if (
      typeof navigator !== "undefined" &&
      !navigator.onLine
    ) {
      toast.error(
        "Abra o caixa enquanto houver conexão; depois ele pode operar em contingência.",
      );
      return;
    }

    setBusy(true);

    try {
      const normalizedTerminal = terminalCode
        .trim()
        .toUpperCase();

      const current: any = await getSession({
        data: {
          terminalCode: normalizedTerminal,
        },
      });

      const activeId = current?.id
        ? current.id
        : (
            (await openSession({
              data: {
                branchId:
                  warehouse.branch_id,
                warehouseId: warehouse.id,
                terminalCode:
                  normalizedTerminal,
                openingAmount:
                  Number(
                    openingAmount.replace(
                      ",",
                      ".",
                    ),
                  ) || 0,
              },
            })) as any
          )?.id;

      if (!activeId) {
        throw new Error(
          "O servidor não retornou a sessão de caixa.",
        );
      }

      setTerminalCode(normalizedTerminal);
      setSessionId(activeId);

      await setPosLocalValue(
        SESSION_CACHE_KEY,
        {
          terminalCode: normalizedTerminal,
          sessionId: activeId,
          warehouseId: warehouse.id,
        },
      );

      toast.success(
        "Caixa aberto e pronto para vender",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível abrir o caixa",
      );
    } finally {
      setBusy(false);
    }
  }

  function paymentValue() {
    const parsed = Number(
      amount.replace(",", "."),
    );
    return parsed > 0
      ? roundMoney(parsed)
      : remaining;
  }

  async function addPayment() {
    if (remaining <= 0) return;

    if (
      typeof navigator !== "undefined" &&
      !navigator.onLine &&
      method !== "cash"
    ) {
      toast.error(
        "Em contingência offline, use dinheiro. Pagamentos eletrônicos exigem validação online para evitar cobrança sem baixa de estoque.",
      );
      return;
    }

    const entered = paymentValue();

    if (!(entered > 0)) {
      toast.error("Informe um valor válido");
      return;
    }

    if (method === "cash") {
      const applied = Math.min(
        entered,
        remaining,
      );

      setPayments((rows) => [
        ...rows,
        {
          method,
          amount: roundMoney(applied),
          installments: 1,
        },
      ]);

      setChangeDue(
        roundMoney(
          Math.max(0, entered - remaining),
        ),
      );
      setAmount("");
      return;
    }

    if (entered > remaining + 0.001) {
      toast.error(
        "O valor não pode ultrapassar o restante da venda",
      );
      return;
    }

    const value = roundMoney(entered);
    const installmentCount =
      method === "credit_card"
        ? Math.max(
            1,
            Math.trunc(
              Number(installments) || 1,
            ),
          )
        : 1;

    const integrated =
      method === "pix" ||
      method === "debit_card" ||
      method === "credit_card";

    if (integrated && stoneAvailable) {
      setBusy(true);

      try {
        const result =
          await requestStonePayment({
            amount: value,
            method: method as
              | "pix"
              | "debit_card"
              | "credit_card",
            installments:
              installmentCount,
            orderId: `${Date.now()}`,
          });

        const reference =
          result.providerReference ||
          result.atk ||
          result.itk ||
          result.authorizationCode;

        if (!reference) {
          throw new Error(
            "Stone aprovou, mas não retornou uma referência transacional.",
          );
        }

        setPayments((rows) => [
          ...rows,
          {
            method,
            amount: value,
            installments:
              installmentCount,
            provider: "stone",
            provider_reference:
              reference,
          },
        ]);

        toast.success(
          `${paymentLabels[method]} aprovado na Stone`,
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Pagamento Stone não aprovado",
        );
      } finally {
        setBusy(false);
      }

      setAmount("");
      return;
    }

    if (
      integrated &&
      !externalReference.trim()
    ) {
      toast.error(
        "Neste dispositivo o pagamento é externo. Informe NSU/ID/identificador da transação.",
      );
      return;
    }

    setPayments((rows) => [
      ...rows,
      {
        method,
        amount: value,
        installments: installmentCount,
        provider: integrated
          ? "external_terminal"
          : undefined,
        provider_reference: integrated
          ? externalReference.trim()
          : undefined,
      },
    ]);

    setAmount("");
    setExternalReference("");
  }

  function currentSalePayload() {
    if (!sessionId) {
      throw new Error("Caixa não aberto");
    }

    return {
      cashSessionId: sessionId,
      idempotencyKey,
      items: items.map((item) => ({
        product_id: item.id,
        quantity: item.quantity,
      })),
      payments: payments.map(
        (payment) => ({
          method: payment.method,
          amount: payment.amount,
          installments:
            payment.installments,
          provider: payment.provider,
          provider_reference:
            payment.provider_reference,
        }),
      ),
      discountAmount: 0,
    };
  }

  function resetSale() {
    setPayments([]);
    setAmount("");
    setExternalReference("");
    setChangeDue(0);
    setIdempotencyKey(
      crypto.randomUUID(),
    );
  }

  async function queueForContingency(
    payload: ReturnType<
      typeof currentSalePayload
    >,
  ) {
    await enqueuePendingPosSale(payload);
    window.dispatchEvent(
      new Event(
        "norte-sul:pos-outbox-changed",
      ),
    );

    const hasElectronicPayment =
      payload.payments.some(
        (payment) =>
          payment.method !== "cash",
      );

    resetSale();

    toast.warning(
      hasElectronicPayment
        ? "Pagamento registrado, mas a baixa da venda ficou pendente de sincronização. Não repita a cobrança; reconcilie assim que a conexão voltar."
        : "Venda salva em contingência. Ela será sincronizada automaticamente quando a conexão voltar.",
    );

    onCompleted(
      `offline-${payload.idempotencyKey}`,
    );
  }

  async function finalize() {
    if (
      !sessionId ||
      items.length === 0 ||
      Math.abs(paid - total) > 0.001
    ) {
      return;
    }

    const payload = currentSalePayload();

    if (
      typeof navigator !== "undefined" &&
      !navigator.onLine
    ) {
      setBusy(true);

      try {
        await queueForContingency(
          payload,
        );
      } finally {
        setBusy(false);
      }

      return;
    }

    setBusy(true);

    try {
      const result = await finishSale({
        data: payload,
      });

      toast.success(
        `Venda concluída #${result.saleId.slice(0, 8)}`,
      );

      resetSale();
      onCompleted(result.saleId);
      void syncPendingSales();
    } catch (error) {
      if (isLikelyNetworkError(error)) {
        await queueForContingency(
          payload,
        );
      } else {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao concluir venda";

        toast.error(
          message.includes(
            "INSUFFICIENT_STOCK",
          )
            ? "Estoque mudou. Atualize o carrinho."
            : message,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function syncPendingSales() {
    if (
      syncing ||
      (typeof navigator !== "undefined" &&
        !navigator.onLine)
    ) {
      return;
    }

    setSyncing(true);

    try {
      const pending =
        await listPendingPosSales();

      for (const sale of pending) {
        try {
          await finishSale({
            data: {
              cashSessionId:
                sale.cashSessionId,
              idempotencyKey:
                sale.idempotencyKey,
              items: sale.items,
              payments: sale.payments,
              discountAmount:
                sale.discountAmount,
              customerId:
                sale.customerId,
            },
          });

          await removePendingPosSale(
            sale.id,
          );

          window.dispatchEvent(
            new Event(
              "norte-sul:pos-outbox-changed",
            ),
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          await markPendingPosSaleFailure(
            sale.id,
            message,
          );

          if (
            isLikelyNetworkError(error)
          ) {
            break;
          }
        }
      }
    } finally {
      setSyncing(false);
    }
  }

  if (!sessionId) {
    return (
      <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-3">
        <PdvConnectionStatus
          onSync={syncPendingSales}
        />

        <p className="text-sm font-semibold">
          Abrir caixa para iniciar
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="terminal">
              Terminal
            </Label>
            <Input
              id="terminal"
              value={terminalCode}
              onChange={(event) =>
                setTerminalCode(
                  event.target.value.toUpperCase(),
                )
              }
            />
          </div>

          <div>
            <Label htmlFor="opening">
              Fundo de caixa
            </Label>
            <Input
              id="opening"
              inputMode="decimal"
              value={openingAmount}
              onChange={(event) =>
                setOpeningAmount(
                  event.target.value,
                )
              }
            />
          </div>
        </div>

        <Button
          className="h-12 w-full text-base font-bold"
          disabled={
            !warehouse ||
            busy ||
            !terminalCode.trim()
          }
          onClick={ensureCashSession}
        >
          {busy ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : null}
          {busy
            ? "Abrindo…"
            : "Abrir caixa"}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PdvConnectionStatus
          onSync={syncPendingSales}
        />
        <span className="text-xs font-semibold text-emerald-700">
          ● {terminalCode} aberto
        </span>
      </div>

      <div className="rounded-xl border bg-background p-3">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              Falta receber
            </p>
            <p className="font-display text-3xl font-black">
              {money.format(
                remaining,
              )}
            </p>
          </div>

          {changeDue > 0 ? (
            <div className="text-right">
              <p className="text-xs uppercase text-muted-foreground">
                Troco
              </p>
              <p className="font-display text-xl font-bold text-emerald-700">
                {money.format(
                  changeDue,
                )}
              </p>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {methods.map(
            ({
              value,
              label,
              icon: Icon,
            }) => (
              <Button
                key={value}
                type="button"
                variant={
                  method === value
                    ? "default"
                    : "outline"
                }
                className="h-16 flex-col gap-1 px-1 text-xs"
                onClick={() => {
                  setMethod(value);
                  setChangeDue(0);
                }}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Button>
            ),
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
          <Input
            inputMode="decimal"
            className="h-11 text-lg font-semibold"
            placeholder={remaining
              .toFixed(2)
              .replace(".", ",")}
            value={amount}
            onChange={(event) =>
              setAmount(
                event.target.value,
              )
            }
          />

          {method ===
          "credit_card" ? (
            <Select
              value={installments}
              onValueChange={
                setInstallments
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(
                  { length: 12 },
                  (_, index) =>
                    index + 1,
                ).map((count) => (
                  <SelectItem
                    key={count}
                    value={String(
                      count,
                    )}
                  >
                    {count}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="hidden sm:block" />
          )}

          <Button
            type="button"
            variant="secondary"
            className="h-11"
            onClick={addPayment}
            disabled={
              remaining <= 0 ||
              busy
            }
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {stoneAvailable &&
            [
              "pix",
              "debit_card",
              "credit_card",
            ].includes(method)
              ? "Cobrar na Stone"
              : "Adicionar"}
          </Button>
        </div>

        {!stoneAvailable &&
        [
          "pix",
          "debit_card",
          "credit_card",
        ].includes(method) ? (
          <div className="mt-2">
            <Label htmlFor="external-reference">
              NSU / ID do pagamento
              externo
            </Label>
            <Input
              id="external-reference"
              value={
                externalReference
              }
              onChange={(event) =>
                setExternalReference(
                  event.target.value,
                )
              }
              placeholder="Obrigatório para cartão/Pix fora da Stone integrada"
            />
          </div>
        ) : null}

        {payments.length > 0 ? (
          <div className="mt-3 space-y-1.5 text-xs">
            {payments.map(
              (
                payment,
                index,
              ) => (
                <button
                  key={`${payment.method}-${index}`}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-left hover:bg-destructive/5"
                  onClick={() =>
                    setPayments(
                      (rows) =>
                        rows.filter(
                          (
                            _,
                            rowIndex,
                          ) =>
                            rowIndex !==
                            index,
                        ),
                    )
                  }
                >
                  <span>
                    {
                      paymentLabels[
                        payment
                          .method
                      ]
                    }
                    {payment.installments >
                    1
                      ? ` · ${payment.installments}x`
                      : ""}
                    {payment.provider ===
                    "stone"
                      ? " · Stone"
                      : ""}
                  </span>
                  <span className="font-semibold">
                    {money.format(
                      payment.amount,
                    )}{" "}
                    · remover
                  </span>
                </button>
              ),
            )}
          </div>
        ) : null}
      </div>

      <Button
        className="h-14 w-full text-lg font-black"
        size="lg"
        disabled={
          busy ||
          items.length === 0 ||
          Math.abs(paid - total) >
            0.001
        }
        onClick={finalize}
      >
        {busy ? (
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        ) : null}
        {busy
          ? "Processando…"
          : `Finalizar · ${money.format(total)}`}
      </Button>

      <p className="text-center text-[11px] text-muted-foreground">
        Preço e estoque são
        validados no servidor. Em
        queda de conexão, a venda
        fica no outbox local com
        idempotência para
        sincronização posterior.
      </p>

      <PdvCashControls
        sessionId={sessionId}
        busy={busy}
        onBusyChange={setBusy}
        onClosed={() => {
          setSessionId(null);
          resetSale();
          void setPosLocalValue(
            SESSION_CACHE_KEY,
            null,
          );
        }}
      />
    </div>
  );
}
