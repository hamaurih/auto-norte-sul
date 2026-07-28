import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bannerUpsert, bannerDelete, bannerToggle, type BannerInput } from "@/lib/banners.functions";
import { Plus, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/banners")({
  head: () => ({ meta: [{ title: "Banners · Admin" }] }),
  component: BannersList,
});

const POSITIONS = ["home_hero", "home_mini", "categoria", "b2b", "promocao", "rodape"];

function emptyBanner(): BannerInput {
  return {
    title: "", subtitle: "", image_url: "", image_mobile_url: "",
    link_url: "", cta_label: "", position: "home_hero",
    sort_order: 0, active: true, audience: "all",
    starts_at: null, ends_at: null,
  };
}

function toInput(v: string | null | undefined) {
  return v ? v.slice(0, 16) : "";
}

function BannersList() {
  const qc = useQueryClient();
  const upsert = useServerFn(bannerUpsert);
  const del = useServerFn(bannerDelete);
  const toggle = useServerFn(bannerToggle);
  const [editing, setEditing] = useState<BannerInput | null>(null);
  const [saving, setSaving] = useState(false);

  const { data = [] } = useQuery({
    queryKey: ["admin-banners"],
    queryFn: async () => (await supabase.from("banners").select("*").order("position").order("sort_order")).data ?? [],
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await upsert({ data: editing });
      toast.success("Banner salvo");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-banners"] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
    finally { setSaving(false); }
  }
  async function handleDelete(id: string) {
    if (!confirm("Excluir banner?")) return;
    try { await del({ data: { id } }); toast.success("Excluído"); qc.invalidateQueries({ queryKey: ["admin-banners"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }
  async function handleToggle(id: string, active: boolean) {
    try { await toggle({ data: { id, active } }); qc.invalidateQueries({ queryKey: ["admin-banners"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold uppercase">Banners</h1>
        <button onClick={() => setEditing(emptyBanner())} className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground">
          <Plus className="h-4 w-4" /> Novo Banner
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data.map((b) => (
          <div key={b.id} className="overflow-hidden rounded-lg border border-border bg-card">
            <img src={b.image_url || "/placeholder.svg"} alt="" className="h-32 w-full object-cover" />
            <div className="p-3">
              <div className="flex items-center justify-between">
                <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">{b.position}</span>
                <span className="text-[10px] uppercase text-muted-foreground">público: {b.audience}</span>
              </div>
              <div className="mt-1 font-display font-bold uppercase">{b.title}</div>
              <div className="text-xs text-muted-foreground line-clamp-1">{b.subtitle}</div>
              <div className="mt-2 flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={b.active} onChange={(e) => handleToggle(b.id, e.target.checked)} />
                  Ativo
                </label>
                <div className="flex gap-1">
                  <button onClick={() => setEditing({ ...(b as any) })} title="Editar" className="rounded bg-muted p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => handleDelete(b.id)} title="Excluir" className="rounded bg-muted p-1.5 hover:bg-destructive hover:text-destructive-foreground"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {data.length === 0 && <div className="col-span-full rounded border border-dashed border-border p-8 text-center text-muted-foreground">Nenhum banner ainda.</div>}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-card p-6 shadow-xl">
            <h2 className="mb-4 font-display text-xl font-bold uppercase">{editing.id ? "Editar banner" : "Novo banner"}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <L label="Título *" full><input required value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={inp} /></L>
              <L label="Subtítulo" full><input value={editing.subtitle ?? ""} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} className={inp} /></L>
              <L label="Imagem desktop (URL) *" full><input required value={editing.image_url} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} className={inp} /></L>
              <L label="Imagem mobile (URL)" full><input value={editing.image_mobile_url ?? ""} onChange={(e) => setEditing({ ...editing, image_mobile_url: e.target.value })} className={inp} /></L>
              <div className="md:col-span-2"><LinkBuilder value={editing.link_url ?? ""} onChange={(v) => setEditing({ ...editing, link_url: v })} /></div>
              <L label="Texto do botão (CTA)"><input value={editing.cta_label ?? ""} onChange={(e) => setEditing({ ...editing, cta_label: e.target.value })} className={inp} /></L>
              <L label="Posição">
                <select value={editing.position} onChange={(e) => setEditing({ ...editing, position: e.target.value })} className={inp}>
                  {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </L>
              <L label="Público">
                <select value={editing.audience} onChange={(e) => setEditing({ ...editing, audience: e.target.value as any })} className={inp}>
                  <option value="all">Todos</option>
                  <option value="b2c">B2C</option>
                  <option value="b2b">B2B</option>
                </select>
              </L>
              <L label="Ordem"><input type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} className={inp} /></L>
              <L label="Ativo">
                <label className="mt-2 inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Publicar
                </label>
              </L>
              <L label="Início"><input type="datetime-local" value={toInput(editing.starts_at)} onChange={(e) => setEditing({ ...editing, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} className={inp} /></L>
              <L label="Fim"><input type="datetime-local" value={toInput(editing.ends_at)} onChange={(e) => setEditing({ ...editing, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} className={inp} /></L>
            </div>
            {editing.image_url && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-bold uppercase text-muted-foreground">Prévia</p>
                <img src={editing.image_url} alt="" className="max-h-48 rounded border border-border object-cover" />
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded border border-border px-4 py-2 text-sm">Cancelar</button>
              <button type="submit" disabled={saving} className="rounded bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground disabled:opacity-50">
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const inp = "w-full rounded border border-border bg-background p-2 text-sm";
function L({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block text-sm ${full ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

type LinkKind = "none" | "custom" | "category" | "brand" | "product" | "page";
const PAGES: { label: string; url: string }[] = [
  { label: "Home", url: "/" },
  { label: "Catálogo", url: "/catalogo" },
  { label: "Ofertas", url: "/catalogo?oferta=1" },
  { label: "Área B2B", url: "/b2b" },
  { label: "Login / Cadastro", url: "/auth" },
];

function detectKind(url: string): LinkKind {
  if (!url) return "none";
  if (url.startsWith("/produto/")) return "product";
  if (url.startsWith("/catalogo?categoria=")) return "category";
  if (url.startsWith("/catalogo?marca=")) return "brand";
  if (PAGES.some((p) => p.url === url)) return "page";
  return "custom";
}

function LinkBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [kind, setKind] = useState<LinkKind>(() => detectKind(value));
  const [productQuery, setProductQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => { const t = setTimeout(() => setDebounced(productQuery.trim()), 250); return () => clearTimeout(t); }, [productQuery]);

  const { data: categories = [] } = useQuery({
    queryKey: ["admin-banners-categories"],
    queryFn: async () => (await supabase.from("categories").select("id, name, slug").order("name")).data ?? [],
  });
  const { data: brands = [] } = useQuery({
    queryKey: ["admin-banners-brands"],
    queryFn: async () => (await supabase.from("brands").select("id, name, slug").order("name")).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["admin-banners-products", debounced],
    enabled: kind === "product" && debounced.length >= 2,
    queryFn: async () =>
      (await supabase.from("products").select("id, name, sku, slug").or(`name.ilike.%${debounced}%,sku.ilike.%${debounced}%`).limit(20)).data ?? [],
  });

  const currentCat = useMemo(() => (kind === "category" ? value.replace("/catalogo?categoria=", "") : ""), [kind, value]);
  const currentBrand = useMemo(() => (kind === "brand" ? value.replace("/catalogo?marca=", "") : ""), [kind, value]);
  const currentProduct = useMemo(() => (kind === "product" ? value.replace("/produto/", "") : ""), [kind, value]);

  function changeKind(k: LinkKind) {
    setKind(k);
    if (k === "none") onChange("");
    else if (k === "custom") onChange(value && detectKind(value) === "custom" ? value : "");
    else onChange("");
  }

  return (
    <div className="rounded border border-border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-bold uppercase text-muted-foreground">Link do banner (para onde o botão leva)</p>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Tipo</span>
          <select value={kind} onChange={(e) => changeKind(e.target.value as LinkKind)} className={inp}>
            <option value="none">Sem link</option>
            <option value="category">Categoria</option>
            <option value="brand">Marca</option>
            <option value="product">Produto específico</option>
            <option value="page">Página do site</option>
            <option value="custom">URL personalizada</option>
          </select>
        </label>

        {kind === "category" && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Categoria</span>
            <select value={currentCat} onChange={(e) => onChange(e.target.value ? `/catalogo?categoria=${e.target.value}` : "")} className={inp}>
              <option value="">Escolha uma categoria...</option>
              {categories.map((c: any) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
        )}

        {kind === "brand" && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Marca</span>
            <select value={currentBrand} onChange={(e) => onChange(e.target.value ? `/catalogo?marca=${e.target.value}` : "")} className={inp}>
              <option value="">Escolha uma marca...</option>
              {brands.map((b: any) => <option key={b.id} value={b.slug}>{b.name}</option>)}
            </select>
          </label>
        )}

        {kind === "page" && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Página</span>
            <select value={value} onChange={(e) => onChange(e.target.value)} className={inp}>
              <option value="">Escolha uma página...</option>
              {PAGES.map((p) => <option key={p.url} value={p.url}>{p.label}</option>)}
            </select>
          </label>
        )}

        {kind === "custom" && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">URL</span>
            <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/catalogo?q=farol" className={inp} />
          </label>
        )}
      </div>

      {kind === "product" && (
        <div className="mt-2 space-y-2">
          <input
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            placeholder="Buscar produto por nome ou SKU..."
            className={inp}
          />
          {currentProduct && !productQuery && (
            <p className="text-xs text-muted-foreground">Selecionado: <code className="rounded bg-muted px-1">/produto/{currentProduct}</code></p>
          )}
          {debounced.length >= 2 && (
            <div className="max-h-48 overflow-auto rounded border border-border bg-background">
              {products.length === 0 && <div className="p-2 text-xs text-muted-foreground">Nenhum produto encontrado.</div>}
              {products.map((p: any) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => { onChange(`/produto/${p.slug}`); setProductQuery(""); }}
                  className={`flex w-full items-center justify-between gap-2 border-b border-border p-2 text-left text-sm last:border-0 hover:bg-muted ${currentProduct === p.slug ? "bg-primary/10" : ""}`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{p.sku}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {value && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Destino: <code className="rounded bg-muted px-1">{value}</code>
        </p>
      )}
    </div>
  );
}
