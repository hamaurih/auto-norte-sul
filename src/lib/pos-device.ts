export type PosDeviceKind = "browser" | "android" | "stone-smartpos";

export type PosDeviceInfo = {
  kind: PosDeviceKind;
  platform: string;
  model?: string;
  appVersion?: string;
  stoneAvailable: boolean;
  printerAvailable: boolean;
};

export type StonePaymentRequest = {
  amount: number;
  method: "pix" | "debit_card" | "credit_card";
  installments?: number;
  orderId?: string;
};

export type StonePaymentResult = {
  ok: boolean;
  requestId: string;
  code: string;
  message?: string;
  amount?: number;
  atk?: string;
  itk?: string;
  authorizationCode?: string;
  brand?: string;
  pan?: string;
  entryMode?: string;
  installments?: number;
  providerReference?: string;
  raw: Record<string, string>;
};

export type StoneCancelRequest = {
  amount: number;
  atk: string;
};

type NativeBridge = {
  getDeviceInfo?: () => string;
  isStoneAvailable?: () => boolean;
  pay?: (payload: string) => void;
  cancel?: (payload: string) => void;
  print?: (payload: string) => void;
};

declare global {
  interface Window {
    NorteSulPOS?: NativeBridge;
  }
}

const EVENT_PAYMENT = "norte-sul:stone-payment-result";
const EVENT_CANCEL = "norte-sul:stone-cancel-result";
const EVENT_PRINT = "norte-sul:stone-print-result";

function bridge(): NativeBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.NorteSulPOS;
}

export function getPosDeviceInfo(): PosDeviceInfo {
  const native = bridge();
  if (!native) {
    return {
      kind: "browser",
      platform: typeof navigator === "undefined" ? "server" : navigator.platform || "web",
      stoneAvailable: false,
      printerAvailable: false,
    };
  }

  try {
    const raw = native.getDeviceInfo?.();
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PosDeviceInfo>;
      return {
        kind: parsed.kind === "stone-smartpos" ? "stone-smartpos" : "android",
        platform: parsed.platform ?? "Android",
        model: parsed.model,
        appVersion: parsed.appVersion,
        stoneAvailable: Boolean(parsed.stoneAvailable),
        printerAvailable: Boolean(parsed.printerAvailable),
      };
    }
  } catch {
    // Fallback seguro abaixo.
  }

  return {
    kind: "android",
    platform: "Android",
    stoneAvailable: Boolean(native.isStoneAvailable?.()),
    printerAvailable: Boolean(native.print),
  };
}

export function isStonePaymentAvailable() {
  const native = bridge();
  if (!native?.pay) return false;
  try {
    return native.isStoneAvailable ? Boolean(native.isStoneAvailable()) : true;
  } catch {
    return false;
  }
}

function stoneTransactionType(method: StonePaymentRequest["method"]) {
  if (method === "pix") return "PIX";
  if (method === "debit_card") return "DEBIT";
  return "CREDIT";
}

function waitNativeEvent<T extends { requestId?: string }>(
  eventName: string,
  requestId: string,
  timeoutMs = 180_000,
) {
  return new Promise<T>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Integração nativa indisponível no servidor."));
      return;
    }

    const timeout = window.setTimeout(() => {
      window.removeEventListener(eventName, onResult as EventListener);
      reject(new Error("A operação na maquininha excedeu o tempo de resposta."));
    }, timeoutMs);

    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<T>).detail;
      if (!detail || detail.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener(eventName, onResult as EventListener);
      resolve(detail);
    };

    window.addEventListener(eventName, onResult as EventListener);
  });
}

export async function requestStonePayment(
  request: StonePaymentRequest,
): Promise<StonePaymentResult> {
  const native = bridge();
  if (!native?.pay || !isStonePaymentAvailable()) {
    throw new Error("Pagamento Stone não está disponível neste dispositivo.");
  }

  const requestId = crypto.randomUUID();
  const amountCents = Math.round(request.amount * 100);
  if (!(amountCents > 0)) throw new Error("Valor do pagamento inválido.");

  const installments = Math.max(1, Math.trunc(request.installments ?? 1));
  const payload = {
    requestId,
    amountCents,
    transactionType: stoneTransactionType(request.method),
    installmentType:
      request.method === "credit_card" && installments > 1 ? "MERCHANT" : "NONE",
    installmentCount: installments,
    orderId: request.orderId ?? Date.now().toString(),
    editableAmount: false,
    returnScheme: "nortesulpos",
  };

  const resultPromise = waitNativeEvent<StonePaymentResult>(
    EVENT_PAYMENT,
    requestId,
  );
  native.pay(JSON.stringify(payload));
  const result = await resultPromise;
  if (!result.ok) {
    throw new Error(
      result.message || `Pagamento não aprovado (${result.code || "erro"}).`,
    );
  }
  return result;
}

export async function requestStoneCancellation(request: StoneCancelRequest) {
  const native = bridge();
  if (!native?.cancel) {
    throw new Error("Cancelamento Stone indisponível neste dispositivo.");
  }
  if (!request.atk.trim()) throw new Error("ATK da transação não informado.");

  const requestId = crypto.randomUUID();
  const resultPromise = waitNativeEvent<{
    requestId: string;
    ok: boolean;
    message?: string;
    raw: Record<string, string>;
  }>(EVENT_CANCEL, requestId);

  native.cancel(
    JSON.stringify({
      requestId,
      amountCents: Math.round(request.amount * 100),
      atk: request.atk,
      returnScheme: "nortesulpos",
    }),
  );
  const result = await resultPromise;
  if (!result.ok) {
    throw new Error(result.message || "Cancelamento Stone não aprovado.");
  }
  return result;
}

export async function printOnStone(
  lines: Array<{
    content: string;
    align?: "left" | "center" | "right";
    size?: "small" | "medium" | "big";
  }>,
) {
  const native = bridge();
  if (!native?.print) {
    throw new Error("Impressão Stone indisponível neste dispositivo.");
  }
  const requestId = crypto.randomUUID();
  const printable = lines.map((line) => ({
    type: "text",
    content: line.content,
    align: line.align ?? "left",
    size: line.size ?? "small",
  }));
  const resultPromise = waitNativeEvent<{
    requestId: string;
    ok: boolean;
    message?: string;
  }>(EVENT_PRINT, requestId, 60_000);

  native.print(
    JSON.stringify({ requestId, printable, returnScheme: "nortesulpos" }),
  );
  const result = await resultPromise;
  if (!result.ok) {
    throw new Error(result.message || "Falha ao imprimir na Stone.");
  }
  return result;
}

export const POS_NATIVE_EVENTS = {
  payment: EVENT_PAYMENT,
  cancel: EVENT_CANCEL,
  print: EVENT_PRINT,
} as const;
