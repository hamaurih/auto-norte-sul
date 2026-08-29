import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resolveActiveTenantId } from "@/lib/tenant-access";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vendedor/clientes")({
  head: () => ({ meta: [{ title: "Meus clientes · Vendedor" }] }),
  component: Clientes,
});

function Clientes() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ lead_name: "", lead_email: "", lead_phone: "", lead_cnpj: "", notes: "" });

  const { data } = useQuery({
    queryKey: ["vendedor-clientes"],
    queryFn: async () => {
      const { data: rep } = await supabase.from("sales_reps").select("id").eq("user_id", (await supabase.auth.getUser()).data.user!.id).maybeSingle();
      if (!rep) return { rep_id: null as string | null, list: [] as any[] };
      const { data: list } = await supabase.from("sales_rep_customers").select("*").eq("rep_id", rep.id).order("created_at", { ascending: false });
      return { rep_id: rep.id, list: list ?? [] };
    },
  });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!data?.rep_id) return;
    const tenantId = await resolveActiveTenantId();
    if (!tenantId) {
      toast.error("Tenant ativo não encontrado.");
      return;
    }
    const { error } = await supabase
      .from("sales_rep_customers")
      .insert({ rep_id: data.rep_id, tenant_id: tenantId, ...form });
    if (error) toast.error(error.message);
    else {
      toast.success("Cliente/lead adicionado");
      setForm({ lead_name: "", lead_email: "", lead_phone: "", lead_cnpj: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["vendedor-clientes"] });
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 font-display font-bold uppercase">Cadastrar cliente / lead</h3>
        <div className="grid grid-cols-2 gap-3">
          <input required placeholder="Nome" value={form.lead_name} onChange={(e) => setForm({ ...form, lead_name: e.target.value })} className="rounded border border-border bg-background p-2 text-sm" />
          <input placeholder="E-mail" type="email" value={form.lead_email} onChange={(e) => setForm({ ...form, lead_email: e.target.value })} className="rounded border border-border bg-background p-2 text-sm" />
          <input placeholder="Telefone / WhatsApp" value={form.lead_phone} onChange={(e) => setForm({ ...form, lead_phone: e.target.value })} className="rounded border border-border bg-background p-2 text-sm" />
          <input placeholder="CNPJ" value={form.lead_cnpj} onChange={(e) => setForm({ ...form, lead_cnpj: e.target.value })} className="rounded border border-border bg-background p-2 text-sm" />
        </div>
        <textarea placeholder="Notas" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-3 w-full rounded border border-border bg-background p-2 text-sm" />
        <button className="mt-3 rounded bg-primary px-4 py-2 text-xs font-bold uppercase text-primary-foreground">Adicionar</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase">
            <tr>
              <th className="p-2 text-left">Nome</th>
              <th className="p-2 text-left">Contato</th>
              <th className="p-2 text-left">CNPJ</th>
              <th className="p-2 text-left">Notas</th>
            </tr>
          </thead>
          <tbody>
            {(data?.list ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="p-2">{c.lead_name ?? "—"}</td>
                <td className="p-2 text-xs">{c.lead_email} <br /> {c.lead_phone}</td>
                <td className="p-2 text-xs">{c.lead_cnpj ?? "—"}</td>
                <td className="p-2 text-xs">{c.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
