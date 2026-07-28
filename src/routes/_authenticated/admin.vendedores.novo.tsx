import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { inviteSalesRep } from "@/lib/sales-reps.functions";

export const Route = createFileRoute("/_authenticated/admin/vendedores/novo")({
  head: () => ({ meta: [{ title: "Novo vendedor · Norte Sul" }] }),
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const isStaff = (roles ?? []).some((r) => r.role === "admin" || r.role === "gerente");
    if (!isStaff) throw redirect({ to: "/" });
  },
  component: NovoVendedor,
});

function NovoVendedor() {
  const navigate = useNavigate();
  const invite = useServerFn(inviteSalesRep);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", commission_pct: 0, notes: "" });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await invite({ data: form });
      toast.success("Vendedor convidado por e-mail");
      navigate({ to: "/admin/vendedores" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao convidar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-x py-6">
      <h1 className="mb-4 font-display text-3xl font-bold uppercase">Novo vendedor</h1>
      <form onSubmit={submit} className="max-w-xl space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <label className="text-xs font-bold uppercase">Nome completo</label>
          <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="mt-1 w-full rounded border border-border bg-background p-2" />
        </div>
        <div>
          <label className="text-xs font-bold uppercase">E-mail</label>
          <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded border border-border bg-background p-2" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold uppercase">Telefone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded border border-border bg-background p-2" />
          </div>
          <div>
            <label className="text-xs font-bold uppercase">Comissão (%)</label>
            <input type="number" step="0.01" value={form.commission_pct} onChange={(e) => setForm({ ...form, commission_pct: Number(e.target.value) })} className="mt-1 w-full rounded border border-border bg-background p-2" />
          </div>
        </div>
        <div>
          <label className="text-xs font-bold uppercase">Notas</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="mt-1 w-full rounded border border-border bg-background p-2" />
        </div>
        <p className="rounded bg-muted p-3 text-xs">
          O vendedor receberá um e-mail para criar a senha e acessar <b>/vendedor</b>.
        </p>
        <button disabled={loading} className="rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground disabled:opacity-50">
          {loading ? "Enviando..." : "Convidar vendedor"}
        </button>
      </form>
    </div>
  );
}
