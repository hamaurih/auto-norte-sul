import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import { getSiteSaleAlerts } from "@/lib/sales-summary.functions";

type SaleAlert = { id: string; total: number; customer_name: string | null; status: string; created_at: string };
const storageKey = "norte-sul:site-sale-unread";

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function readUnread() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function persistUnread(ids: Set<string>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...ids].slice(0, 50)));
  } catch {
    // A notificação visual continua disponível mesmo se o navegador bloquear o armazenamento local.
  }
}

function playSaleSound() {
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(1175, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.09, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.42);
    window.setTimeout(() => void context.close(), 600);
  } catch {
    // Alguns navegadores só permitem áudio depois de uma interação; o aviso visual permanece.
  }
}

/** Alertas de vendas do site confirmadas pelo webhook de pagamento. */
export function SiteSaleAlerts() {
  const alertsFn = useServerFn(getSiteSaleAlerts);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SaleAlert[]>([]);
  const [unread, setUnread] = useState<Set<string>>(() => readUnread());
  const initialized = useRef(false);
  const knownIds = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const next = (await alertsFn()) as SaleAlert[];
      const ids = new Set(next.map((sale) => sale.id));
      setRows(next);

      if (!initialized.current) {
        initialized.current = true;
        knownIds.current = ids;
        setUnread((current) => {
          const kept = new Set([...current].filter((id) => ids.has(id)));
          persistUnread(kept);
          return kept;
        });
        return;
      }

      const fresh = next.filter((sale) => !knownIds.current.has(sale.id));
      knownIds.current = ids;
      if (!fresh.length) return;

      setUnread((current) => {
        const updated = new Set([...current, ...fresh.map((sale) => sale.id)]);
        persistUnread(updated);
        return updated;
      });

      for (const sale of fresh.reverse()) {
        playSaleSound();
        toast.success(`Nova venda confirmada · ${brl(Number(sale.total ?? 0))}`, {
          description: sale.customer_name || "Pagamento confirmado no site",
          duration: 10_000,
        });
      }
    } catch {
      // Usuários sem permissão comercial não devem receber detalhes de vendas.
    }
  }, [alertsFn]);

  useEffect(() => {
    let active = true;
    void refresh();
    const timer = window.setInterval(() => { if (active) void refresh(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);

  const unreadCount = unread.size;
  const markAllRead = () => {
    const cleared = new Set<string>();
    setUnread(cleared);
    persistUnread(cleared);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-blue-100 bg-white text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={unreadCount ? `${unreadCount} nova(s) venda(s) no site` : "Notificações de vendas do site"}
        title="Vendas confirmadas no site"
      >
        <Bell className="size-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-black leading-5 text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section className="absolute right-0 top-12 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl" aria-label="Notificações de vendas">
          <header className="flex items-center gap-3 border-b border-slate-100 p-4">
            <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-700"><MonitorSmartphone className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-black">Vendas confirmadas no site</h2>
              <p className="text-xs text-slate-500">Atualização automática a cada 15 segundos.</p>
            </div>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900">
                <CheckCheck className="size-3.5" /> Lidas
              </button>
            )}
          </header>
          <div className="max-h-80 divide-y overflow-y-auto">
            {rows.length ? rows.map((sale) => (
              <article key={sale.id} className={`flex gap-3 p-4 ${unread.has(sale.id) ? "bg-blue-50/60" : ""}`}>
                <span className="mt-0.5 size-2 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/10" aria-label="Pagamento confirmado" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{sale.customer_name || "Cliente do site"}</p>
                  <p className="text-xs text-slate-500">Pedido #{sale.id.slice(0, 8)} · {new Date(sale.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
                </div>
                <strong className="shrink-0 text-sm">{brl(Number(sale.total ?? 0))}</strong>
              </article>
            )) : <p className="p-6 text-center text-sm text-slate-500">Nenhuma venda confirmada recentemente.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
