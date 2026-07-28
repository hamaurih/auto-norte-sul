import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin/cadastros-b2b")({
  head: () => ({ meta: [{ title: "Cadastros B2B · Admin" }] }),
  component: B2BList,
});

type Reg = {
  id: string;
  user_id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  whatsapp: string;
  cidade: string;
  estado: string | null;
  segmento: string;
  volume_medio_compra: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
};

function B2BList() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Reg | null>(null);
  const [notes, setNotes] = useState("");

  const { data: list = [] } = useQuery({
    queryKey: ["b2b-list"],
    queryFn: async () => {
      const { data } = await supabase.from("b2b_registrations").select("*").order("created_at", { ascending: false });
      return (data ?? []) as Reg[];
    },
  });

  async function decide(regId: string, userId: string, status: "aprovado" | "reprovado", group?: "revendedor" | "oficina" | "distribuidor") {
    const updates: { status: "aprovado" | "reprovado"; reviewed_at: string; admin_notes?: string } = { status, reviewed_at: new Date().toISOString() };
    if (notes) updates.admin_notes = notes;
    await supabase.from("b2b_registrations").update(updates).eq("id", regId);
    if (status === "aprovado" && group) {
      await supabase.from("profiles").update({ customer_group: group, b2b_status: "approved" }).eq("id", userId);
    } else if (status === "reprovado") {
      await supabase.from("profiles").update({ customer_group: "b2c", b2b_status: "rejected" }).eq("id", userId);
    }
    toast.success(`Cadastro ${status}`);
    qc.invalidateQueries({ queryKey: ["b2b-list"] });
    setSelected(null);
    setNotes("");
  }

  async function requestInfo(regId: string) {
    const message = window.prompt("Que informação deseja solicitar?");
    if (!message) return;
    await supabase
      .from("b2b_registrations")
      .update({ admin_notes: message, status: "pendente" })
      .eq("id", regId);
    toast.info("Anotação registrada. Envie ao cliente via WhatsApp/e-mail.");
    qc.invalidateQueries({ queryKey: ["b2b-list"] });
  }

  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-bold uppercase">Cadastros B2B</h1>
      <div className="space-y-3">
        {list.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cadastro.</p>}
        {list.map((r) => (
          <div key={r.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-display text-lg font-bold uppercase">{r.razao_social}</div>
                <div className="text-xs text-muted-foreground">
                  CNPJ {r.cnpj} · {r.cidade}
                  {r.estado ? `/${r.estado}` : ""} · {r.segmento}
                </div>
                {r.nome_fantasia && <div className="text-xs">Fantasia: {r.nome_fantasia}</div>}
                <div className="text-xs">
                  WhatsApp: {r.whatsapp} · Volume: {r.volume_medio_compra ?? "—"}
                </div>
                {r.admin_notes && <div className="mt-1 text-xs italic text-muted-foreground">Nota interna: {r.admin_notes}</div>}
              </div>
              <span
                className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${
                  r.status === "pendente"
                    ? "bg-hot text-hot-foreground"
                    : r.status === "aprovado"
                    ? "bg-success text-success-foreground"
                    : "bg-destructive text-destructive-foreground"
                }`}
              >
                {r.status}
              </span>
            </div>
            {r.status === "pendente" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setSelected(r);
                    setNotes(r.admin_notes ?? "");
                  }}
                  className="rounded bg-success px-3 py-1.5 text-xs font-bold uppercase text-success-foreground hover:brightness-110"
                >
                  Aprovar
                </button>
                <button
                  onClick={() => decide(r.id, r.user_id, "reprovado")}
                  className="rounded bg-destructive px-3 py-1.5 text-xs font-bold uppercase text-destructive-foreground hover:brightness-110"
                >
                  Reprovar
                </button>
                <button
                  onClick={() => requestInfo(r.id)}
                  className="rounded border border-border px-3 py-1.5 text-xs font-bold uppercase hover:bg-muted"
                >
                  Solicitar informações
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar {selected?.razao_social}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase">Grupo comercial</label>
              <div className="flex flex-wrap gap-2">
                {(["revendedor", "oficina", "distribuidor"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => selected && decide(selected.id, selected.user_id, "aprovado", g)}
                    className="rounded bg-primary px-3 py-2 text-xs font-bold uppercase text-primary-foreground hover:brightness-110"
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase">Observação interna (opcional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[80px] w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setSelected(null)} className="rounded border border-border px-3 py-1.5 text-xs font-bold uppercase hover:bg-muted">
              Cancelar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
