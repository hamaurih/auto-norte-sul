import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { toast } from "sonner";
import { User as UserIcon, Package, Store, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated/conta")({
  head: () => ({ meta: [{ title: "Minha Conta · Norte Sul" }] }),
  component: Conta,
});

function Conta() {
  const { user, roles, isB2BApproved } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle().then(({ data }) => {
      setName(data?.full_name ?? "");
      setPhone(data?.phone ?? "");
    });
  }, [user?.id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({ id: user.id, full_name: name, phone });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Perfil atualizado");
  }

  return (
    <div className="container-x py-6">
      <h1 className="mb-4 font-display text-3xl font-bold uppercase">Minha conta</h1>
      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <nav className="space-y-1">
          <span className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-semibold text-primary"><UserIcon className="h-4 w-4" /> Perfil</span>
          <Link to="/pedidos" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"><Package className="h-4 w-4" /> Meus pedidos</Link>
          <Link to="/b2b" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"><Store className="h-4 w-4" /> Cadastro B2B</Link>
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.href = "/"; }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </nav>

        <form onSubmit={save} className="max-w-lg space-y-3 rounded-lg border border-border bg-card p-4">
          <div>
            <span className="text-xs text-muted-foreground">Email</span>
            <div className="text-sm font-semibold">{user?.email}</div>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Grupos</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {roles.map((r) => (
                <span key={r} className="rounded bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase">{r}</span>
              ))}
            </div>
            {isB2BApproved && <p className="mt-1 text-xs text-success">✓ Preço de atacado ativo</p>}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase">Nome completo</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase">WhatsApp</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>
          <button disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground hover:brightness-110 disabled:opacity-60">
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </form>
      </div>
    </div>
  );
}
