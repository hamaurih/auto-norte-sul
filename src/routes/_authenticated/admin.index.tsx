import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Admin · Norte Sul" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [{ count: orders }, { count: products }, { count: customers }, { count: pending }] = await Promise.all([
        supabase.from("orders").select("*", { count: "exact", head: true }),
        supabase.from("products").select("*", { count: "exact", head: true }),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("b2b_registrations").select("*", { count: "exact", head: true }).eq("status", "pendente"),
      ]);
      const { data: lowStock } = await supabase.from("products").select("sku, name, stock").lt("stock", 5).order("stock").limit(5);
      return { orders, products, customers, pending, lowStock: lowStock ?? [] };
    },
  });

  const cards = [
    { label: "Pedidos", value: data?.orders ?? 0 },
    { label: "Produtos", value: data?.products ?? 0 },
    { label: "Clientes", value: data?.customers ?? 0 },
    { label: "B2B pendentes", value: data?.pending ?? 0, hot: true },
  ];

  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-bold uppercase">Dashboard</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-lg border p-4 ${c.hot ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
            <div className="text-xs uppercase text-muted-foreground">{c.label}</div>
            <div className="mt-1 font-display text-3xl font-bold">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 font-display text-lg font-bold uppercase">Estoque crítico</h3>
        {(data?.lowStock ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Tudo em estoque.</p>
        ) : (
          <ul className="text-sm">
            {data?.lowStock.map((p) => (
              <li key={p.sku} className="flex justify-between border-b border-border py-1 last:border-0">
                <span>
                  {p.name} <span className="text-xs text-muted-foreground">({p.sku})</span>
                </span>
                <span className={`font-bold ${p.stock === 0 ? "text-destructive" : "text-hot"}`}>{p.stock} unid.</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
