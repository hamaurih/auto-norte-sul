import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  CircleDollarSign,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/pedidos")({
  head: () => ({ meta: [{ title: "Pedidos · Admin" }] }),
  component: OrdersList,
});

const statusStyles: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  pendente: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  pago: "bg-emerald-100 text-emerald-800",
  approved: "bg-emerald-100 text-emerald-800",
  aprovado: "bg-emerald-100 text-emerald-800",
  processing: "bg-blue-100 text-blue-800",
  processando: "bg-blue-100 text-blue-800",
  shipped: "bg-violet-100 text-violet-800",
  enviado: "bg-violet-100 text-violet-800",
  delivered: "bg-cyan-100 text-cyan-800",
  entregue: "bg-cyan-100 text-cyan-800",
  cancelled: "bg-rose-100 text-rose-800",
  cancelado: "bg-rose-100 text-rose-800",
};

function statusTone(status: string | null) {
  return statusStyles[(status ?? "").toLocaleLowerCase("pt-BR")] ?? "bg-slate-100 text-slate-700";
}

function displayStatus(status: string | null) {
  return (status || "Sem status").replaceAll("_", " ");
}

function OrdersList() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState<"" | "b2b" | "b2c">("");

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, customer_name, customer_email, status, total, created_at, is_b2b, bling_number")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const statuses = useMemo(
    () => Array.from(new Set(data.map((order) => order.status).filter((status): status is string => Boolean(status))).sort(),
    [data],
  );

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return data.filter((order) => {
      const matchesSearch =
        !normalizedQuery ||
        order.id.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        (order.customer_name ?? "").toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        (order.customer_email ?? "").toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        String(order.bling_number ?? "").toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      const matchesStatus = !statusFilter || order.status === statusFilter;
      const matchesChannel =
        !channelFilter ||
        (channelFilter === "b2b" ? order.is_b2b : !order.is_b2b);
      return matchesSearch && matchesStatus && matchesChannel;
    });
  }, [channelFilter, data, query, statusFilter]);

  const totalValue = data.reduce((sum, order) => sum + Number(order.total ?? 0), 0);
  const b2bCount = data.filter((order) => order.is_b2b).length;
  const b2cCount = data.length - b2bCount;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="admin-page-hero">
        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-violet-600/10 px-3 py-1 text-xs font-extrabold text-violet-700">
              <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
              Central comercial
            </span>
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Pedidos
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Localize vendas, acompanhe os canais B2B e B2C e identifique rapidamente o andamento de cada pedido.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isLoading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-white/80 px-4 text-sm font-extrabold text-violet-700 shadow-sm transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
            Atualizar
          </button>
        </div>
      </header>

      <section aria-label="Resumo dos pedidos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={ShoppingBag} label="Pedidos carregados" value={String(data.length)} tone="blue" />
        <SummaryCard icon={CircleDollarSign} label="Valor total" value={brl(totalValue)} tone="emerald" />
        <SummaryCard icon={BriefcaseBusiness} label="Pedidos B2B" value={String(b2bCount)} tone="violet" />
        <SummaryCard icon={Store} label="Pedidos B2C" value={String(b2cCount)} tone="amber" />
      </section>

      <section className="admin-filter-bar grid gap-3 lg:grid-cols-[minmax(280px,1fr)_220px_180px]">
        <label className="relative">
          <span className="sr-only">Buscar pedido</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por cliente, e-mail, pedido ou número Bling"
            className="w-full pl-10"
          />
        </label>
        <label>
          <span className="sr-only">Filtrar por status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full">
            <option value="">Todos os status</option>
            {statuses.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filtrar por canal</span>
          <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value as "" | "b2b" | "b2c")} className="w-full">
            <option value="">Todos os canais</option>
            <option value="b2b">B2B</option>
            <option value="b2c">B2C</option>
          </select>
        </label>
      </section>

      {isError ? (
        <div role="alert" className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          Não foi possível carregar os pedidos. Verifique a conexão e tente atualizar.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-border/70 bg-card shadow-sm">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr>
                <th className="p-3 text-left">Pedido</th>
                <th className="p-3 text-left">Cliente</th>
                <th className="p-3 text-left">Data</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Canal</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-left">Bling</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id} className="border-t border-border/70">
                  <td className="p-3 font-mono text-xs font-bold text-violet-700">#{order.id.slice(0, 8)}</td>
                  <td className="p-3">
                    <span className="font-bold">{order.customer_name || "Cliente não identificado"}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{order.customer_email || "Sem e-mail"}</span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(order.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold capitalize ${statusTone(order.status)}`}>
                      {displayStatus(order.status)}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${order.is_b2b ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>
                      {order.is_b2b ? "B2B" : "B2C"}
                    </span>
                  </td>
                  <td className="p-3 text-right price-tag">{brl(Number(order.total ?? 0))}</td>
                  <td className="p-3 text-xs font-semibold">{order.bling_number ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && filteredOrders.length === 0 && (
            <div className="border-t border-border/70 px-5 py-10 text-center">
              <p className="font-bold">Nenhum pedido encontrado</p>
              <p className="mt-1 text-sm text-muted-foreground">Ajuste os filtros para ampliar a busca.</p>
            </div>
          )}
          {isLoading && (
            <div className="border-t border-border/70 px-5 py-10 text-center text-sm text-muted-foreground">
              Carregando pedidos…
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Exibindo {filteredOrders.length} de {data.length} pedidos mais recentes.
      </p>
    </div>
  );
}

const summaryTones = {
  blue: "border-blue-200 bg-gradient-to-br from-blue-50 to-white text-blue-700",
  emerald: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white text-emerald-700",
  violet: "border-violet-200 bg-gradient-to-br from-violet-50 to-white text-violet-700",
  amber: "border-amber-200 bg-gradient-to-br from-amber-50 to-white text-amber-700",
} as const;

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ShoppingBag;
  label: string;
  value: string;
  tone: keyof typeof summaryTones;
}) {
  return (
    <article className={`rounded-3xl border p-4 shadow-sm ${summaryTones[tone]}`}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-white/80 shadow-sm">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-muted-foreground">{label}</p>
          <p className="mt-0.5 truncate font-display text-xl font-extrabold text-foreground">{value}</p>
        </div>
      </div>
    </article>
  );
}
