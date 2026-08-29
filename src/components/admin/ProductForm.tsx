import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { checkInternalCodeDuplicate, productUpsert, type ProductInput } from "@/lib/products.functions";
import { normalizeCode, normalizeName } from "@/lib/product-codes";
import { slugify } from "@/lib/format";
import { Trash2, ArrowUp, ArrowDown, Star, Plus, Upload, Loader2 } from "lucide-react";

type Img = { url: string; alt?: string | null; is_primary?: boolean };

function toInput(v: string | null | undefined) {
  return v ? v.slice(0, 16) : "";
}

export function ProductForm({ initial }: { initial?: Partial<ProductInput> & { id?: string; images?: Img[] } }) {
  const navigate = useNavigate();
  const upsert = useServerFn(productUpsert);
  const checkDup = useServerFn(checkInternalCodeDuplicate);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [tab, setTab] = useState<"geral" | "precos" | "estoque" | "imagens">("geral");
  const [saving, setSaving] = useState(false);
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
      const bucket = supabase.storage.from("product-images");
      const uploaded: Img[] = [];
      for (const file of arr) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${form.sku || "novo"}/${crypto.randomUUID()}.${ext}`;
        const up = await bucket.upload(path, file, {
          contentType: file.type,
          cacheControl: "31536000",
          upsert: false,
        });
        if (up.error) throw up.error;
        // Long-lived signed URL (10 years) — works while bucket is private.
        const signed = await bucket.createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
        if (signed.error) throw signed.error;
        uploaded.push({ url: signed.data.signedUrl, alt: file.name, is_primary: false });
      }
      setForm((f) => {
        const existing = f.images ?? [];
        const merged = [...existing, ...uploaded];
        // Se não havia principal, primeira nova vira principal
        if (!existing.some((i) => i.is_primary) && merged.length > 0) {
          merged[0] = { ...merged[0], is_primary: true };
        }
        return { ...f, images: merged };
      });
      toast.success(`${uploaded.length} imagem(ns) enviada(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function verifyInternalCode() {
    const code = normalizeCode(form.internal_code);
    if (!code) { setDupWarning(null); return; }
    try {
      const res = await checkDup({ data: { internal_code: code, excludeId: form.id ?? null } });
      setDupWarning(
        res.duplicate
          ? `Atenção: código interno já usado em ${res.products.map((p) => p.name).join(", ")}`
          : null,
      );
    } catch { setDupWarning(null); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const name = normalizeName(form.name);
      if (!name) { toast.error("Nome do produto é obrigatório"); setSaving(false); return; }
      const payload: ProductInput = {
        ...form,
        name,
        sku: normalizeCode(form.sku) ?? form.sku,
        internal_code: normalizeCode(form.internal_code),
        manufacturer_code: normalizeCode(form.manufacturer_code),
        slug: form.slug || slugify(name),
        images: (form.images ?? []).filter((i) => i.url.trim().length > 0),
      };
      const res = await upsert({ data: payload });
      toast.success(form.id ? "Produto atualizado" : "Produto criado");
      if (!form.id && res.id) navigate({ to: "/admin/produtos/$id", params: { id: res.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const tabs = [
    { id: "geral", label: "Geral" },
    { id: "precos", label: "Preços & Promoção" },
    { id: "estoque", label: "Estoque" },
    { id: "imagens", label: "Imagens" },
  ] as const;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-bold uppercase ${
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button type="submit" disabled={saving} className="rounded bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground disabled:opacity-50">
            {saving ? "Salvando..." : form.id ? "Salvar alterações" : "Criar produto"}
          </button>
        </div>
      </div>

      {tab === "geral" && (
        <div className="grid gap-4 md:grid-cols-2">
          <L label="Código interno" >
            <input
              value={form.internal_code ?? ""}
              onChange={(e) => update("internal_code", e.target.value.toUpperCase())}
              onBlur={verifyInternalCode}
              className={`${inp} font-mono`}
              placeholder="Ex.: AZ1234 ou F-YH05050ZL"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">Código da Norte Sul. Pode repetir? Não — avisamos se já existir.</span>
            {dupWarning && <span className="mt-1 block text-[11px] font-bold text-hot">{dupWarning}</span>}
          </L>
          <L label="Código do fabricante">
            <input
              value={form.manufacturer_code ?? ""}
              onChange={(e) => update("manufacturer_code", e.target.value.toUpperCase())}
              className={`${inp} font-mono`}
              placeholder="Ex.: 001CP"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">Código do fornecedor/fabricante. Pode repetir entre marcas.</span>
          </L>
          <L label="Nome *">
            <input
              required
              value={form.name}
              onChange={(e) => {
                update("name", e.target.value);
                if (!form.id && !form.slug) update("slug", slugify(e.target.value));
              }}
              className={inp}
            />
          </L>
          <L label="Slug (URL)"><input value={form.slug} onChange={(e) => update("slug", slugify(e.target.value))} className={inp} /></L>
          <L label="Marca">
            <select value={form.brand_id ?? ""} onChange={(e) => update("brand_id", e.target.value || null)} className={inp}>
              <option value="">—</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </L>
          <L label="Categoria">
            <select value={form.category_id ?? ""} onChange={(e) => { update("category_id", e.target.value || null); update("subcategory_id", null); }} className={inp}>
              <option value="">—</option>
              {parentCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </L>
          <L label="Subcategoria">
            <select value={form.subcategory_id ?? ""} onChange={(e) => update("subcategory_id", e.target.value || null)} className={inp} disabled={subCats.length === 0}>
              <option value="">—</option>
              {subCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </L>
          <L label="Descrição curta" full>
            <input value={form.short_description ?? ""} onChange={(e) => update("short_description", e.target.value)} className={inp} maxLength={200} />
          </L>
          <L label="Descrição completa" full>
            <textarea value={form.description ?? ""} onChange={(e) => update("description", e.target.value)} rows={6} className={inp} />
          </L>
          <L label="SKU / Bling (campo técnico) *" full>
            <input required value={form.sku} onChange={(e) => update("sku", e.target.value.toUpperCase())} className={`${inp} font-mono`} />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Identificador técnico de integração com o Bling. Não é o código interno nem o do fabricante; mantenha como está salvo.
            </span>
          </L>
          <div className="md:col-span-2 flex flex-wrap gap-4 rounded border border-border p-3">
            <Chk label="Ativo" checked={form.active ?? true} onChange={(v) => update("active", v)} />
            <Chk label="Destaque" checked={form.featured ?? false} onChange={(v) => update("featured", v)} />
            <Chk label="Lançamento" checked={form.is_new ?? false} onChange={(v) => update("is_new", v)} />
            <Chk label="Mais vendido" checked={form.is_bestseller ?? false} onChange={(v) => update("is_bestseller", v)} />
            <Chk label="Oferta" checked={form.is_offer ?? false} onChange={(v) => update("is_offer", v)} />
          </div>
        </div>
      )}

      {tab === "precos" && (
        <div className="grid gap-4 md:grid-cols-2">
          <L label="Preço B2C *"><input required type="number" step="0.01" value={form.price_b2c} onChange={(e) => update("price_b2c", Number(e.target.value))} className={inp} /></L>
          <L label="Preço B2B"><input type="number" step="0.01" value={form.price_b2b ?? ""} onChange={(e) => update("price_b2b", e.target.value ? Number(e.target.value) : null)} className={inp} /></L>
          <L label="Preço 'de' (comparação)"><input type="number" step="0.01" value={form.compare_at_price ?? ""} onChange={(e) => update("compare_at_price", e.target.value ? Number(e.target.value) : null)} className={inp} /></L>
          <L label="Preço promocional B2C"><input type="number" step="0.01" value={form.sale_price_b2c ?? ""} onChange={(e) => update("sale_price_b2c", e.target.value ? Number(e.target.value) : null)} className={inp} /></L>
          <L label="Promoção — início">
            <input type="datetime-local" value={toInput(form.sale_starts_at)} onChange={(e) => update("sale_starts_at", e.target.value ? new Date(e.target.value).toISOString() : null)} className={inp} />
          </L>
          <L label="Promoção — fim">
            <input type="datetime-local" value={toInput(form.sale_ends_at)} onChange={(e) => update("sale_ends_at", e.target.value ? new Date(e.target.value).toISOString() : null)} className={inp} />
          </L>
        </div>
      )}

      {tab === "estoque" && (
        <div className="grid gap-4 md:grid-cols-2">
          <L label="Estoque (somente leitura)">
            <input
              type="number"
              value={form.stock ?? 0}
              readOnly
              disabled
              title="Saldo gerido pelo estoque (product_stock). Ajuste pelo módulo de Estoque."
              className={inp}
            />
          </L>
          <L label="Estoque mínimo (alerta)"><input type="number" value={form.min_stock ?? 0} onChange={(e) => update("min_stock", Number(e.target.value))} className={inp} /></L>
          <L label="Peso (kg)"><input type="number" step="0.001" value={form.weight_kg ?? ""} onChange={(e) => update("weight_kg", e.target.value ? Number(e.target.value) : null)} className={inp} /></L>
          <div className="md:col-span-2">
            <Chk label="Ocultar quando esgotado" checked={form.hide_when_out_of_stock ?? false} onChange={(v) => update("hide_when_out_of_stock", v)} />
          </div>
        </div>
      )}

      {tab === "imagens" && (
        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}
            className="rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 text-center"
          >
            <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-semibold">Arraste imagens aqui ou clique em enviar</p>
            <p className="mt-1 text-xs text-muted-foreground">JPG, PNG ou WebP · Múltiplos arquivos permitidos</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "Enviando..." : "Enviar do computador"}
              </button>
              <button
                type="button"
                onClick={addImg}
                className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 text-sm"
              >
                <Plus className="h-4 w-4" /> Adicionar por URL
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); }}
            />
          </div>
          <p className="rounded bg-muted p-3 text-xs text-muted-foreground">
            💡 Imagens sincronizadas do Bling já aparecem aqui automaticamente após rodar
            <strong> Ecossistema → Bling → Sincronizar imagens</strong>. Você também pode enviar
            novas fotos do seu computador ou colar URLs externas.
          </p>
          {(form.images ?? []).map((img, i) => (
            <div key={i} className="flex items-start gap-2 rounded border border-border p-3">
              <img src={img.url || "/placeholder.svg"} alt="" className="h-16 w-16 rounded object-cover bg-muted" />
              <div className="flex-1 space-y-2">
                <input placeholder="https://..." value={img.url} onChange={(e) => updateImg(i, { url: e.target.value })} className={inp} />
                <input placeholder="Texto alternativo (alt)" value={img.alt ?? ""} onChange={(e) => updateImg(i, { alt: e.target.value })} className={inp} />
              </div>
              <div className="flex flex-col gap-1">
                <button type="button" title="Principal" onClick={() => setPrimary(i)} className={`rounded p-1 ${img.is_primary ? "bg-primary text-primary-foreground" : "bg-muted"}`}><Star className="h-4 w-4" /></button>
                <button type="button" onClick={() => moveImg(i, -1)} className="rounded bg-muted p-1"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => moveImg(i, 1)} className="rounded bg-muted p-1"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => removeImg(i)} className="rounded bg-destructive p-1 text-destructive-foreground"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
          {(form.images ?? []).length === 0 && (
            <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nenhuma imagem adicionada ainda.
            </div>
          )}
        </div>
      )}
    </form>
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
function Chk({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
