import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { categoryUpsert, categoryDelete, type CategoryInput } from "@/lib/taxonomy.functions";
import { slugify } from "@/lib/format";
import { Pencil, Trash2, Plus, X, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/categorias")({
  head: () => ({ meta: [{ title: "Categorias · Admin" }] }),
  component: CategoriesAdmin,
});

type Cat = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  icon: string | null;
  image_url: string | null;
  sort_order: number;
  active: boolean;
};

function CategoriesAdmin() {
  const qc = useQueryClient();
  const upsert = useServerFn(categoryUpsert);
  const del = useServerFn(categoryDelete);
  const [editing, setEditing] = useState<CategoryInput | null>(null);

  const { data: cats = [], isLoading } = useQuery({
    queryKey: ["admin-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name,slug,parent_id,icon,image_url,sort_order,active")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Cat[];
    },
  });

  const { parents, childrenBy } = useMemo(() => {
    const parents = cats.filter((c) => !c.parent_id);
    const childrenBy = new Map<string, Cat[]>();
    for (const c of cats) {
      if (c.parent_id) {
        const arr = childrenBy.get(c.parent_id) ?? [];
        arr.push(c);
        childrenBy.set(c.parent_id, arr);
      }
    }
    return { parents, childrenBy };
  }, [cats]);

  async function save(input: CategoryInput) {
    try {
      await upsert({ data: input });
      toast.success("Categoria salva");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-categories"] });
      qc.invalidateQueries({ queryKey: ["categories-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Excluir categoria "${name}"?`)) return;
    try {
      await del({ data: { id } });
      toast.success("Categoria excluída");
      qc.invalidateQueries({ queryKey: ["admin-categories"] });
      qc.invalidateQueries({ queryKey: ["categories-all"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  function renderRow(c: Cat, depth = 0) {
    return (
      <div key={c.id}>
        <div className="flex items-center gap-2 border-t border-border p-2 text-sm" style={{ paddingLeft: 8 + depth * 20 }}>
          {depth > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          {c.image_url && <img src={c.image_url} alt="" className="h-6 w-6 rounded object-cover" />}
          <span className="font-semibold">{c.name}</span>
          <span className="text-xs text-muted-foreground">/{c.slug}</span>
          {!c.active && <span className="rounded bg-muted px-1 text-[10px] uppercase">inativa</span>}
          <span className="ml-2 text-xs text-muted-foreground">ordem: {c.sort_order}</span>
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => setEditing({ name: "", slug: "", parent_id: c.id, sort_order: 0, active: true })}
              className="rounded bg-muted p-1"
              title="Adicionar subcategoria"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button onClick={() => setEditing(c as CategoryInput)} className="rounded bg-muted p-1"><Pencil className="h-4 w-4" /></button>
            <button onClick={() => remove(c.id, c.name)} className="rounded bg-destructive p-1 text-destructive-foreground"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
        {(childrenBy.get(c.id) ?? []).map((child) => renderRow(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Categorias</h1>
        <button
          onClick={() => setEditing({ name: "", slug: "", parent_id: null, sort_order: 0, active: true })}
          className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-bold uppercase text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> Nova categoria
        </button>
      </div>

      <div className="overflow-hidden rounded border border-border">
        {isLoading && <div className="p-4 text-center text-muted-foreground">Carregando...</div>}
        {!isLoading && parents.length === 0 && <div className="p-4 text-center text-muted-foreground">Nenhuma categoria.</div>}
        {parents.map((c) => renderRow(c))}
      </div>

      {editing && <CategoryModal initial={editing} parents={parents} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function CategoryModal({
  initial, parents, onClose, onSave,
}: {
  initial: CategoryInput;
  parents: Cat[];
  onClose: () => void;
  onSave: (c: CategoryInput) => void;
}) {
  const [form, setForm] = useState<CategoryInput>(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-card p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{form.id ? "Editar categoria" : "Nova categoria"}</h2>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-3">
          <Field label="Nome *">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })} className={inp} />
          </Field>
          <Field label="Slug">
            <input value={form.slug ?? ""} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} className={inp} />
          </Field>
          <Field label="Categoria pai">
            <select value={form.parent_id ?? ""} onChange={(e) => setForm({ ...form, parent_id: e.target.value || null })} className={inp}>
              <option value="">— Nenhuma (categoria raiz)</option>
              {parents.filter((p) => p.id !== form.id).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ordem">
              <input type="number" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} className={inp} />
            </Field>
            <Field label="Ícone (lucide)">
              <input value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value })} className={inp} placeholder="ex: Wrench" />
            </Field>
          </div>
          <Field label="URL da imagem">
            <input value={form.image_url ?? ""} onChange={(e) => setForm({ ...form, image_url: e.target.value })} className={inp} placeholder="https://..." />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active ?? true} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Ativa
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
