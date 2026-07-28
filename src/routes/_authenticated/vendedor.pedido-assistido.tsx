import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vendedor/pedido-assistido")({
  head: () => ({ meta: [{ title: "Pedido assistido · Vendedor" }] }),
  component: PedidoAssistido,
});

interface Item { product_id: string; sku: string; name: string; price: number; qty: number }

function PedidoAssistido() {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [lead, setLead] = useState({ lead_name: "", lead_email: "", lead_phone: "", lead_cnpj: "", notes: "" });

  const { data: results = [] } = useQuery({
    queryKey: ["asst-search", search],
    enabled: search.length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, sku, name, price_b2c, price_b2b, stock")
        .eq("active", true)
        .or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
        .limit(10);
      return data ?? [];
    },
  });

  function addItem(p: any) {
    const price = Number(p.price_b2b ?? p.price_b2c);
    setItems((prev) => {
      const found = prev.find((i) => i.product_id === p.id);
      if (found) return prev.map((i) => (i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { product_id: p.id, sku: p.sku, name: p.name, price, qty: 1 }];
    });
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);

  async function save(status: "rascunho" | "enviado") {
    const { data: userRes } = await supabase.auth.getUser();
    const { data: rep } = await supabase.from("sales_reps").select("id").eq("user_id", userRes.user!.id).maybeSingle();
    if (!rep) return toast.error("Perfil vendedor não encontrado");

    const { error } = await supabase.from("sales_orders").insert({
      rep_id: rep.id,
      ...lead,
      items: items as any,
      subtotal,
      total: subtotal,
      status,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(status === "enviado" ? "Pedido enviado" : "Rascunho salvo");
      setItems([]);
      setLead({ lead_name: "", lead_email: "", lead_phone: "", lead_cnpj: "", notes: "" });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div>
          <input
            placeholder="Buscar produto por nome ou SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-border bg-background p-2 text-sm"
          />
          {results.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded border border-border bg-card">
              {results.map((p) => (
                <button key={p.id} onClick={() => addItem(p)} className="flex w-full items-center justify-between border-b border-border p-2 text-left text-sm hover:bg-muted">
                  <span>
                    <b>{p.name}</b> <span className="text-xs text-muted-foreground">({p.sku}) · estoque {p.stock}</span>
                  </span>
                  <span className="price-tag">{brl(Number(p.price_b2b ?? p.price_b2c))}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase">
              <tr><th className="p-2 text-left">Produto</th><th className="p-2 text-right">Qtd</th><th className="p-2 text-right">Preço</th><th className="p-2 text-right">Subtotal</th><th></th></tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-xs text-muted-foreground">Nenhum item</td></tr>}
              {items.map((i, idx) => (
                <tr key={i.product_id} className="border-t border-border">
                  <td className="p-2">{i.name}</td>
                  <td className="p-2 text-right">
                    <input type="number" min={1} value={i.qty} onChange={(e) => {
                      const q = Math.max(1, Number(e.target.value));
                      setItems((prev) => prev.map((it, j) => (j === idx ? { ...it, qty: q } : it)));
                    }} className="w-16 rounded border border-border bg-background p-1 text-right" />
                  </td>
                  <td className="p-2 text-right">{brl(i.price)}</td>
                  <td className="p-2 text-right price-tag">{brl(i.price * i.qty)}</td>
                  <td className="p-2 text-right">
                    <button onClick={() => setItems((prev) => prev.filter((_, j) => j !== idx))} className="text-destructive">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-display font-bold uppercase">Cliente</h3>
        <input placeholder="Nome" value={lead.lead_name} onChange={(e) => setLead({ ...lead, lead_name: e.target.value })} className="w-full rounded border border-border bg-background p-2 text-sm" />
        <input placeholder="E-mail" value={lead.lead_email} onChange={(e) => setLead({ ...lead, lead_email: e.target.value })} className="w-full rounded border border-border bg-background p-2 text-sm" />
        <input placeholder="Telefone" value={lead.lead_phone} onChange={(e) => setLead({ ...lead, lead_phone: e.target.value })} className="w-full rounded border border-border bg-background p-2 text-sm" />
        <input placeholder="CNPJ" value={lead.lead_cnpj} onChange={(e) => setLead({ ...lead, lead_cnpj: e.target.value })} className="w-full rounded border border-border bg-background p-2 text-sm" />
        <textarea placeholder="Notas" rows={2} value={lead.notes} onChange={(e) => setLead({ ...lead, notes: e.target.value })} className="w-full rounded border border-border bg-background p-2 text-sm" />

        <div className="border-t border-border pt-3 text-sm">
          <div className="flex justify-between"><span>Total</span><span className="price-tag text-lg">{brl(subtotal)}</span></div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => save("rascunho")} className="flex-1 rounded border border-border px-3 py-2 text-xs font-bold uppercase hover:bg-muted">Salvar rascunho</button>
          <button onClick={() => save("enviado")} disabled={items.length === 0 || !lead.lead_name} className="flex-1 rounded bg-primary px-3 py-2 text-xs font-bold uppercase text-primary-foreground disabled:opacity-50">Enviar pedido</button>
        </div>
      </aside>
    </div>
  );
}
