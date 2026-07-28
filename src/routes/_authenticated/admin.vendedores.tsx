import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/vendedores")({
  head: () => ({ meta: [{ title: "Vendedores · Norte Sul" }] }),
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const isStaff = (roles ?? []).some((r) => r.role === "admin" || r.role === "gerente");
    if (!isStaff) throw redirect({ to: "/" });
  },
  component: VendedoresList,
});

function VendedoresList() {
  const { data = [] } = useQuery({
    queryKey: ["sales-reps"],
    queryFn: async () => {
      const { data } = await supabase.from("sales_reps").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="container-x py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold uppercase">Vendedores</h1>
        <Link
          to="/admin/vendedores/novo"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Novo vendedor
        </Link>
      </div>

      {data.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <UserPlus className="mx-auto mb-2 h-8 w-8" />
          Nenhum vendedor cadastrado ainda.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase">
            <tr>
              <th className="p-2 text-left">Nome</th>
              <th className="p-2 text-left">E-mail</th>
              <th className="p-2 text-left">Telefone</th>
              <th className="p-2 text-right">Comissão</th>
              <th className="p-2 text-center">Status</th>
              <th className="p-2 text-left">Convidado em</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2 font-medium">{r.full_name}</td>
                <td className="p-2">{r.email}</td>
                <td className="p-2">{r.phone ?? "—"}</td>
                <td className="p-2 text-right">{Number(r.commission_pct).toFixed(2)}%</td>
                <td className="p-2 text-center">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${r.active ? "bg-success text-success-foreground" : "bg-muted"}`}>
                    {r.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="p-2 text-xs">{new Date(r.invited_at).toLocaleDateString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
