import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { brl } from "@/lib/format";
import { cancelOrder } from "@/lib/order.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pedidos")({
  head: () => ({ meta: [{ title: "Meus pedidos · Norte Sul" }] }),
  component: Pedidos,
});

function pickupLabel(order: any) {
  if (order.fulfillment_type !== "pickup") return null;
  if (order.pickup_status === "ready") return "Pronto para retirada";
  if (order.pickup_status === "picked_up" || order.status === "entregue") return "Retirado";
  if (order.pickup_status === "cancelled" || order.status === "cancelado") return "Retirada cancelada";
  if (order.status === "aguardando_pagamento") return "Aguardando pagamento";
  return "Preparando para retirada";
}

function pickupTone(order: any) {
  if (order.pickup_status === "ready") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (order.pickup_status === "picked_up" || order.status === "entregue") return "border-blue-200 bg-blue-50 text-blue-800";
  if (order.pickup_status === "cancelled" || order.status === "cancelado") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

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
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("id,status,total,payment_method,created_at,bling_number,fulfillment_type,pickup_status,pickup_ready_at,picked_up_at,pickup_branch:branches(name,address,city,state,phone,pickup_instructions),order_items(sku,name,quantity)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
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
          <Link to="/catalogo" className="mt-3 inline-block text-primary underline">
            Ver catálogo
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order: any) => {
            const isPickup = order.fulfillment_type === "pickup";
            const branch = order.pickup_branch;
            return (
              <div key={order.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-display text-lg font-bold uppercase">
                      Pedido #{order.id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isPickup && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase text-emerald-800">
                        <Store className="h-3 w-3" /> Retirada na loja
                      </span>
                    )}
                    <span className="rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary">
                      {order.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <span className="price-tag text-xl">{brl(Number(order.total))}</span>
                </div>

                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {(order.order_items ?? []).map((item: any, index: number) => (
                    <li key={index}>
                      {item.quantity}× {item.name} <span className="opacity-60">({item.sku})</span>
                    </li>
                  ))}
                </ul>

                {isPickup && (
                  <div className={`mt-4 rounded-xl border p-3 ${pickupTone(order)}`}>
                    <div className="flex items-center gap-2 text-sm font-bold">
                      <Store className="h-4 w-4" /> {pickupLabel(order)}
                    </div>
                    {branch && (
                      <div className="mt-2 text-xs leading-5">
                        <div className="font-semibold">{branch.name}</div>
                        <div className="flex items-start gap-1">
                          <MapPin className="mt-1 h-3 w-3 shrink-0" />
                          <span>
                            {branch.address || "Endereço da loja"}
                            {branch.city ? ` · ${branch.city}` : ""}
                            {branch.state ? `/${branch.state}` : ""}
                          </span>
                        </div>
                        {order.pickup_status === "ready" && (
                          <p className="mt-2 font-semibold">
                            Seu pedido está liberado. Você já pode ir à loja para retirar.
                          </p>
                        )}
                        {branch.pickup_instructions && order.pickup_status !== "picked_up" && (
                          <p className="mt-1 opacity-80">{branch.pickup_instructions}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {order.status === "aguardando_pagamento" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["pix", "cartao", "boleto"].includes(String(order.payment_method)) && (
                      <Link
                        to="/checkout"
                        search={{ pedido: order.id } as never}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold uppercase text-primary-foreground"
                      >
                        Continuar pagamento
                      </Link>
                    )}
                    <button
                      type="button"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(order.id)}
                      className="rounded-md border border-destructive px-3 py-1.5 text-xs font-semibold text-destructive disabled:opacity-50"
                    >
                      Cancelar pedido
                    </button>
                  </div>
                )}
                {order.bling_number && (
                  <div className="mt-2 text-xs">
                    Bling: <b>{order.bling_number}</b>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}