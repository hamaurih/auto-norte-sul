import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/pedidos")({
  head: () => ({ meta: [{ title: "Pedidos · Admin" }] }),
  component: OrdersList,
});

function OrdersList() {
  const { data = [] } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, customer_name, customer_email, status, total, created_at, is_b2b, bling_number")
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });
  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-bold uppercase">Pedidos</h1>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase">
            <tr>
              <th className="p-2 text-left">Pedido</th>
              <th className="p-2 text-left">Cliente</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Tipo</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2 text-left">Bling</th>
            </tr>
          </thead>
          <tbody>
            {data.map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="p-2 font-mono text-xs">#{o.id.slice(0, 8)}</td>
                <td className="p-2">
                  {o.customer_name}
                  <br />
                  <span className="text-xs text-muted-foreground">{o.customer_email}</span>
                </td>
                <td className="p-2 text-xs uppercase">{o.status}</td>
                <td className="p-2 text-xs">{o.is_b2b ? "B2B" : "B2C"}</td>
                <td className="p-2 text-right price-tag">{brl(Number(o.total))}</td>
                <td className="p-2 text-xs">{o.bling_number ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
