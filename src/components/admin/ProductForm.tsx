import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { supabaseUrl } from "@/integrations/supabase/env";
import { checkInternalCodeDuplicate, productUpsert, type ProductInput } from "@/lib/products.functions";
import { importProductImageUrl } from "@/lib/product-images.functions";

import { normalizeCode, normalizeName } from "@/lib/product-codes";
import { slugify } from "@/lib/format";
import { Trash2, ArrowUp, ArrowDown, Star, Plus, Upload, Loader2 } from "lucide-react";

type Img = { url: string; alt?: string | null; is_primary?: boolean };

const STORAGE_PUBLIC_PREFIX = `${supabaseUrl()}/storage/v1/object/`;

/** Já hospedada por nós (bucket público `product-images` desta instância). */
function isOwnStorageUrl(url: string) {
  const value = url.trim();
  if (!value || !STORAGE_PUBLIC_PREFIX.startsWith("http")) return false;
  return value.startsWith(`${STORAGE_PUBLIC_PREFIX}public/product-images/`)
    || value.startsWith(`${STORAGE_PUBLIC_PREFIX}sign/product-images/`);
}

function toInput(v: string | null | undefined) {
  return v ? v.slice(0, 16) : "";
}


export function ProductForm({ initial }: { initial?: Partial<ProductInput> & { id?: string; images?: Img[] } }) {
  const navigate = useNavigate();
  const upsert = useServerFn(productUpsert);
  const checkDup = useServerFn(checkInternalCodeDuplicate);
  const importImage = useServerFn(importProductImageUrl);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [tab, setTab] = useState<"geral" | "precos" | "estoque" | "imagens">("geral");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const [form, setForm] = useState<ProductInput>({
    id: initial?.id ?? null,
    sku: initial?.sku ?? "",
    internal_code: initial?.internal_code ?? "",
    manufacturer_code: initial?.manufacturer_code ?? "",
    name: initial?.name ?? "",
    slug: initial?.slug ?? "",
    short_description: initial?.short_description ?? "",
    description: initial?.description ?? "",
    brand_id: initial?.brand_id ?? null,
    category_id: initial?.category_id ?? null,
    subcategory_id: initial?.subcategory_id ?? null,
    price_b2c: Number(initial?.price_b2c ?? 0),
    price_b2b: initial?.price_b2b ?? null,
    compare_at_price: initial?.compare_at_price ?? null,
    sale_price_b2c: initial?.sale_price_b2c ?? null,
    sale_starts_at: initial?.sale_starts_at ?? null,
    sale_ends_at: initial?.sale_ends_at ?? null,
    stock: initial?.stock ?? 0,
    min_stock: initial?.min_stock ?? 0,
    hide_when_out_of_stock: initial?.hide_when_out_of_stock ?? false,
    active: initial?.active ?? true,
    featured: initial?.featured ?? false,
    is_new: initial?.is_new ?? false,
    is_bestseller: initial?.is_bestseller ?? false,
    is_offer: initial?.is_offer ?? false,
    weight_kg: initial?.weight_kg ?? null,
    images: initial?.images ?? [],
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["brands-all"],
    queryFn: async () => (await supabase.from("brands").select("id,name").order("name")).data ?? [],
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories-all"],
    queryFn: async () =>
      (await supabase.from("categories").select("id,name,parent_id").order("name")).data ?? [],
  });
  const parentCats = categories.filter((c) => !c.parent_id);
  const subCats = categories.filter((c) => c.parent_id === form.category_id);

  function update<K extends keyof ProductInput>(key: K, value: ProductInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateImg(i: number, patch: Partial<Img>) {
    setForm((f) => {
      const imgs = [...(f.images ?? [])];
      imgs[i] = { ...imgs[i], ...patch };
      return { ...f, images: imgs };
    });
  }
  function addImg() {
    setForm((f) => ({ ...f, images: [...(f.images ?? []), { url: "", alt: "", is_primary: (f.images ?? []).length === 0 }] }));
  }
  function removeImg(i: number) {
    setForm((f) => ({ ...f, images: (f.images ?? []).filter((_, idx) => idx !== i) }));
  }
  function moveImg(i: number, dir: -1 | 1) {
    setForm((f) => {
      const imgs = [...(f.images ?? [])];
      const j = i + dir;
      if (j < 0 || j >= imgs.length) return f;
      [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      return { ...f, images: imgs };
    });
  }
  function setPrimary(i: number) {
    setForm((f) => ({ ...f, images: (f.images ?? []).map((img, idx) => ({ ...img, is_primary: idx === i })) }));
  }

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) {
      toast.error("Selecione arquivos de imagem");
      return;
    }
    setUploading(true);
    try {
      const uploaded: Img[] = [];
      for (const file of arr) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const key = `manual/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(key, file, {
          upsert: false,
          contentType: file.type,
        });
        if (error) throw error;
        const { data } = supabase.storage.from("product-images").getPublicUrl(key);
        uploaded.push({ url: data.publicUrl, alt: form.name || file.name, is_primary: false });
      }
      setForm((f) => {
        const current = f.images ?? [];
        const hasPrimary = current.some((img) => img.is_primary);
        const next = uploaded.map((img, idx) => ({
          ...img,
          is_primary: !hasPrimary && current.length === 0 && idx === 0,
        }));
        return { ...f, images: [...current, ...next] };
      });
      toast.success(`${uploaded.length} imagem(ns) enviada(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao enviar imagem");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function save() {
    setSaving(true);
    try {
      const cleanName = normalizeName(form.name);
      if (!cleanName) throw new Error("Nome do produto é obrigatório");
      const cleanSku = normalizeCode(form.sku);
      const cleanInternal = normalizeCode(form.internal_code ?? "");
      const cleanManufacturer = normalizeCode(form.manufacturer_code ?? "");

      const payload: ProductInput = {
        ...form,
        name: cleanName,
        sku: cleanSku,
        internal_code: cleanInternal,
        manufacturer_code: cleanManufacturer,
        slug: form.slug?.trim() || slugify(cleanName),
        price_b2c: Number(form.price_b2c ?? 0),
        stock: Number(form.stock ?? 0),
        min_stock: Number(form.min_stock ?? 0),
        images: (form.images ?? []).filter((img) => img.url.trim()).map((img) => ({
          ...img,
          url: img.url.trim(),
          alt: img.alt?.trim() || cleanName,
        })),
      };

      if (cleanInternal) {
        const duplicate = await checkDup({ data: { internal_code: cleanInternal, product_id: form.id ?? null } });
        if (duplicate?.duplicate) {
          setDupWarning(`Código interno já usado por ${duplicate.name ?? "outro produto"}`);
          throw new Error("Código interno duplicado");
        }
      }
      setDupWarning(null);
      const result = await upsert({ data: payload });
      if (!result?.id) throw new Error("Produto não salvo");
      toast.success(form.id ? "Produto atualizado" : "Produto criado");
      navigate({ to: "/admin/produtos" });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar produto");
    } finally {
      setSaving(false);
    }
  }

  async function importUrl(i: number) {
    const img = (form.images ?? [])[i];
    if (!img?.url) return;
    if (isOwnStorageUrl(img.url)) {
      toast.info("Essa imagem já está no armazenamento oficial");
      return;
    }
    setImporting(true);
    try {
      const result = await importImage({ data: { url: img.url, alt: img.alt ?? form.name } });
      if (!result?.url) throw new Error("Imagem não importada");
      updateImg(i, { url: result.url });
      toast.success("Imagem copiada para o armazenamento oficial");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao importar imagem");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {([
          ["geral", "Geral"],
          ["precos", "Preços"],
          ["estoque", "Estoque"],
          ["imagens", "Imagens"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === value ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "geral" && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Nome</span><input className="input" value={form.name} onChange={(e) => update("name", e.target.value)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">SKU</span><input className="input" value={form.sku} onChange={(e) => update("sku", e.target.value)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Código interno</span><input className="input" value={form.internal_code ?? ""} onChange={(e) => update("internal_code", e.target.value)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Código fabricante</span><input className="input" value={form.manufacturer_code ?? ""} onChange={(e) => update("manufacturer_code", e.target.value)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Slug</span><input className="input" value={form.slug ?? ""} onChange={(e) => update("slug", e.target.value)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Marca</span><select className="input" value={form.brand_id ?? ""} onChange={(e) => update("brand_id", e.target.value || null)}><option value="">Sem marca</option>{brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="space-y-1"><span className="text-sm font-medium">Categoria</span><select className="input" value={form.category_id ?? ""} onChange={(e) => { update("category_id", e.target.value || null); update("subcategory_id", null); }}><option value="">Sem categoria</option>{parentCats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="space-y-1"><span className="text-sm font-medium">Subcategoria</span><select className="input" value={form.subcategory_id ?? ""} onChange={(e) => update("subcategory_id", e.target.value || null)}><option value="">Sem subcategoria</option>{subCats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Descrição curta</span><input className="input" value={form.short_description ?? ""} onChange={(e) => update("short_description", e.target.value)} /></label>
          <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Descrição</span><textarea className="input min-h-32" value={form.description ?? ""} onChange={(e) => update("description", e.target.value)} /></label>
          {dupWarning && <div className="md:col-span-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{dupWarning}</div>}
        </div>
      )}

      {tab === "precos" && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1"><span className="text-sm font-medium">Preço B2C</span><input className="input" type="number" step="0.01" value={form.price_b2c} onChange={(e) => update("price_b2c", Number(e.target.value))} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Preço B2B</span><input className="input" type="number" step="0.01" value={form.price_b2b ?? ""} onChange={(e) => update("price_b2b", e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Preço de comparação</span><input className="input" type="number" step="0.01" value={form.compare_at_price ?? ""} onChange={(e) => update("compare_at_price", e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Preço promocional</span><input className="input" type="number" step="0.01" value={form.sale_price_b2c ?? ""} onChange={(e) => update("sale_price_b2c", e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Início promoção</span><input className="input" type="datetime-local" value={toInput(form.sale_starts_at)} onChange={(e) => update("sale_starts_at", e.target.value ? new Date(e.target.value).toISOString() : null)} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Fim promoção</span><input className="input" type="datetime-local" value={toInput(form.sale_ends_at)} onChange={(e) => update("sale_ends_at", e.target.value ? new Date(e.target.value).toISOString() : null)} /></label>
        </div>
      )}

      {tab === "estoque" && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1"><span className="text-sm font-medium">Estoque</span><input className="input" type="number" value={form.stock} onChange={(e) => update("stock", Number(e.target.value))} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Estoque mínimo</span><input className="input" type="number" value={form.min_stock} onChange={(e) => update("min_stock", Number(e.target.value))} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form.hide_when_out_of_stock)} onChange={(e) => update("hide_when_out_of_stock", e.target.checked)} /> Ocultar sem estoque</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form.active)} onChange={(e) => update("active", e.target.checked)} /> Ativo</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form.featured)} onChange={(e) => update("featured", e.target.checked)} /> Destaque</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form.is_new)} onChange={(e) => update("is_new", e.target.checked)} /> Lançamento</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form.is_bestseller)} onChange={(e) => update("is_bestseller", e.target.checked)} /> Mais vendido</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form.is_offer)} onChange={(e) => update("is_offer", e.target.checked)} /> Oferta</label>
        </div>
      )}

      {tab === "imagens" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={addImg}><Plus className="h-4 w-4" /> Adicionar URL</button>
            <button type="button" className="btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}><Upload className="h-4 w-4" /> {uploading ? "Enviando..." : "Enviar arquivo"}</button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
          </div>
          {(form.images ?? []).map((img, i) => (
            <div key={`${i}-${img.url}`} className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[88px_1fr_auto] md:items-center">
              <div className="h-20 w-20 overflow-hidden rounded bg-muted">{img.url ? <img src={img.url} alt={img.alt ?? form.name} className="h-full w-full object-contain" /> : null}</div>
              <div className="space-y-2">
                <input className="input" placeholder="URL da imagem" value={img.url} onChange={(e) => updateImg(i, { url: e.target.value })} />
                <input className="input" placeholder="Texto alternativo" value={img.alt ?? ""} onChange={(e) => updateImg(i, { alt: e.target.value })} />
                {!isOwnStorageUrl(img.url) && img.url ? <button type="button" className="text-xs font-semibold text-primary" onClick={() => importUrl(i)} disabled={importing}>{importing ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}Copiar para armazenamento oficial</button> : null}
              </div>
              <div className="flex gap-1">
                <button type="button" title="Principal" onClick={() => setPrimary(i)} className={img.is_primary ? "text-amber-500" : "text-muted-foreground"}><Star className="h-4 w-4" /></button>
                <button type="button" title="Subir" onClick={() => moveImg(i, -1)}><ArrowUp className="h-4 w-4" /></button>
                <button type="button" title="Descer" onClick={() => moveImg(i, 1)}><ArrowDown className="h-4 w-4" /></button>
                <button type="button" title="Excluir" onClick={() => removeImg(i)}><Trash2 className="h-4 w-4 text-destructive" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar produto"}</button>
      </div>
    </div>
  );
}
