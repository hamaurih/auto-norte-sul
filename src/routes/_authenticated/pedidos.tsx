import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { brl } from "@/lib/format";
import { cancelOrder } from "@/lib/order.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pedidos")({
  head: () => ({ meta: [{ title: "Meus pedidos · Norte Sul" }] }),
  component: Pedidos,
});

function Pedidos() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: (orderId: string) => cancelOrder({ data: { orderId } }),
    onSuccess: async () => {
      toast.success("Pedido cancelado e estoque liberado.");
      await queryClient.invalidateQueries({ queryKey: ["orders", user?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, status, total, created_at, bling_number, order_items(sku, name, quantity)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="container-x py-6">
      <h1 className="mb-4 font-display text-3xl font-bold uppercase">Meus pedidos</h1>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">Você ainda não fez nenhum pedido.</p>
          <Link to="/catalogo" className="mt-3 inline-block text-primary underline">Ver catálogo</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-display text-lg font-bold uppercase">Pedido #{o.id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString("pt-BR")}</div>
                </div>
                <span className="rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary">{o.status}</span>
                <span className="price-tag text-xl">{brl(Number(o.total))}</span>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {(o.order_items ?? []).map((i, k) => (
                  <li key={k}>{i.quantity}× {i.name} <span className="opacity-60">({i.sku})</span></li>
                ))}
              </ul>
              {o.status === "aguardando_pagamento" && (
                <button
                  type="button"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(o.id)}
                  className="mt-3 rounded-md border border-destructive px-3 py-1.5 text-xs font-semibold text-destructive disabled:opacity-50"
                >
                  Cancelar pedido
                </button>
              )}
              {o.bling_number && <div className="mt-2 text-xs">Bling: <b>{o.bling_number}</b></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
