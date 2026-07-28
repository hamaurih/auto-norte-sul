import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brandUpsert, brandDelete, type BrandInput } from "@/lib/taxonomy.functions";
import { slugify } from "@/lib/format";
import { Pencil, Trash2, Plus, Star, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/marcas")({
  head: () => ({ meta: [{ title: "Marcas · Admin" }] }),
  component: BrandsAdmin,
});

function BrandsAdmin() {
  const qc = useQueryClient();
  const upsert = useServerFn(brandUpsert);
  const del = useServerFn(brandDelete);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<BrandInput | null>(null);

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["admin-brands"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("id,name,slug,logo_url,featured").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(
    () => brands.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())),
    [brands, q],
  );

  async function save(input: BrandInput) {
    try {
      await upsert({ data: input });
      toast.success("Marca salva");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-brands"] });
      qc.invalidateQueries({ queryKey: ["brands-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Excluir marca "${name}"?`)) return;
    try {
      await del({ data: { id } });
      toast.success("Marca excluída");
      qc.invalidateQueries({ queryKey: ["admin-brands"] });
      qc.invalidateQueries({ queryKey: ["brands-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Marcas</h1>
        <button
          onClick={() => setEditing({ name: "", slug: "", logo_url: "", featured: false })}
          className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-bold uppercase text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> Nova marca
        </button>
      </div>

      <input
        placeholder="Buscar..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-sm rounded border border-border bg-background p-2 text-sm"
      />

      <div className="overflow-hidden rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Logo</th>
              <th className="p-2 text-left">Nome</th>
              <th className="p-2 text-left">Slug</th>
              <th className="p-2 text-left">Destaque</th>
              <th className="p-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Carregando...</td></tr>}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Nenhuma marca.</td></tr>
            )}
            {filtered.map((b) => (
              <tr key={b.id} className="border-t border-border">
                <td className="p-2">
                  {b.logo_url ? (
                    <img src={b.logo_url} alt="" className="h-8 w-8 rounded object-contain bg-muted" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted" />
                  )}
                </td>
                <td className="p-2 font-semibold">{b.name}</td>
                <td className="p-2 text-muted-foreground">{b.slug}</td>
                <td className="p-2">{b.featured && <Star className="h-4 w-4 fill-primary text-primary" />}</td>
                <td className="p-2 text-right">
                  <button onClick={() => setEditing(b as BrandInput)} className="mr-2 rounded bg-muted p-1"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(b.id, b.name)} className="rounded bg-destructive p-1 text-destructive-foreground"><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <BrandModal initial={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function BrandModal({ initial, onClose, onSave }: { initial: BrandInput; onClose: () => void; onSave: (b: BrandInput) => void }) {
  const [form, setForm] = useState<BrandInput>(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-card p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{form.id ? "Editar marca" : "Nova marca"}</h2>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); onSave(form); }}
          className="space-y-3"
        >
          <Field label="Nome *">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })} className={inp} />
          </Field>
          <Field label="Slug">
            <input value={form.slug ?? ""} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} className={inp} />
          </Field>
          <Field label="URL do logo">
            <input value={form.logo_url ?? ""} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} className={inp} placeholder="https://..." />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.featured ?? false} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
            Marca em destaque
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded border border-border px-3 py-2 text-sm">Cancelar</button>
            <button type="submit" className="rounded bg-primary px-3 py-2 text-sm font-bold uppercase text-primary-foreground">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inp = "w-full rounded border border-border bg-background p-2 text-sm";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
