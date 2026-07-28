import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/vendedor/meus-pedidos")({
  head: () => ({ meta: [{ title: "Meus pedidos · Vendedor" }] }),
  component: MeusPedidos,
});

function MeusPedidos() {
  const { data = [] } = useQuery({
    queryKey: ["vendedor-pedidos"],
    queryFn: async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const { data: rep } = await supabase.from("sales_reps").select("id").eq("user_id", userRes.user!.id).maybeSingle();
      if (!rep) return [];
      const { data } = await supabase.from("sales_orders").select("*").eq("rep_id", rep.id).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted text-xs uppercase">
          <tr>
            <th className="p-2 text-left">Pedido</th>
            <th className="p-2 text-left">Cliente</th>
            <th className="p-2 text-left">Status</th>
            <th className="p-2 text-right">Itens</th>
            <th className="p-2 text-right">Total</th>
            <th className="p-2 text-left">Data</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-xs text-muted-foreground">Sem pedidos ainda.</td></tr>}
          {data.map((o) => (
            <tr key={o.id} className="border-t border-border">
              <td className="p-2 font-mono text-xs">#{o.id.slice(0, 8)}</td>
              <td className="p-2">{o.lead_name}<br /><span className="text-xs text-muted-foreground">{o.lead_email}</span></td>
              <td className="p-2 text-xs uppercase">{o.status}</td>
              <td className="p-2 text-right">{Array.isArray(o.items) ? o.items.length : 0}</td>
              <td className="p-2 text-right price-tag">{brl(Number(o.total))}</td>
              <td className="p-2 text-xs">{new Date(o.created_at).toLocaleDateString("pt-BR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
