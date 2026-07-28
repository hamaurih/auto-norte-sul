import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/vendedor/")({
  head: () => ({ meta: [{ title: "Painel Vendedor · Norte Sul" }] }),
  component: VendedorHome,
});

function VendedorHome() {
  const { data } = useQuery({
    queryKey: ["vendedor-stats"],
    queryFn: async () => {
      const { data: rep } = await supabase.from("sales_reps").select("id, full_name, commission_pct").eq("user_id", (await supabase.auth.getUser()).data.user!.id).maybeSingle();
      if (!rep) return null;
      const [{ count: customers }, { count: orders }, { data: recent }] = await Promise.all([
        supabase.from("sales_rep_customers").select("*", { count: "exact", head: true }).eq("rep_id", rep.id),
        supabase.from("sales_orders").select("*", { count: "exact", head: true }).eq("rep_id", rep.id),
        supabase.from("sales_orders").select("id, total, status, created_at").eq("rep_id", rep.id).order("created_at", { ascending: false }).limit(5),
      ]);
      return { rep, customers: customers ?? 0, orders: orders ?? 0, recent: recent ?? [] };
    },
  });

  if (!data) return <p className="text-sm text-muted-foreground">Perfil de vendedor não encontrado.</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs uppercase text-muted-foreground">Bem-vindo</p>
        <p className="font-display text-2xl font-bold">{data.rep.full_name}</p>
        <p className="text-xs">Comissão: <b>{Number(data.rep.commission_pct).toFixed(2)}%</b></p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Clientes</div>
          <div className="mt-1 font-display text-3xl font-bold">{data.customers}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Pedidos</div>
          <div className="mt-1 font-display text-3xl font-bold">{data.orders}</div>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 font-display font-bold uppercase">Últimos pedidos</h3>
        {data.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pedido ainda.</p>
        ) : (
          <ul className="text-sm">
            {data.recent.map((o) => (
              <li key={o.id} className="flex justify-between border-b border-border py-1 last:border-0">
                <span className="font-mono text-xs">#{o.id.slice(0, 8)} · {o.status}</span>
                <span className="price-tag">{brl(Number(o.total))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
