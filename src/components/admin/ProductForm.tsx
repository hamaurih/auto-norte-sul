import { useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BadgeDollarSign,
  Barcode,
  Boxes,
  CarFront,
  CheckCircle2,
  ChevronDown,
  ImagePlus,
  Images,
  Loader2,
  Package,
  Plus,
  Save,
  Star,
  Tag,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";

type Img = { url: string; alt?: string | null; is_primary?: boolean };
type TabKey = "geral" | "comercial" | "estoque" | "imagens";

const STORAGE_PUBLIC_PREFIX = `${supabaseUrl()}/storage/v1/object/`;
const fieldClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-500";
const areaClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

function isOwnStorageUrl(url: string) {
  const value = url.trim();
  if (!value || !STORAGE_PUBLIC_PREFIX.startsWith("http")) return false;
  return value.startsWith(`${STORAGE_PUBLIC_PREFIX}public/product-images/`)
    || value.startsWith(`${STORAGE_PUBLIC_PREFIX}sign/product-images/`);
}

function toInput(v: string | null | undefined) {
  return v ? v.slice(0, 16) : "";
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function SectionCard({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-950">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
        </div>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function ToggleRow({ checked, onChange, title, description }: { checked: boolean; onChange: (value: boolean) => void; title: string; description: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50">
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
      <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-blue-600" />
        <span className="relative ml-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function ProductForm({ initial }: { initial?: Partial<ProductInput> & { id?: string; images?: Img[] } }) {
  const navigate = useNavigate();
  const upsert = useServerFn(productUpsert);
  const checkDup = useServerFn(checkInternalCodeDuplicate);
  const importImage = useServerFn(importProductImageUrl);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("geral");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    queryFn: async () => (await supabase.from("categories").select("id,name,parent_id").order("name")).data ?? [],
  });

  const parentCats = categories.filter((c) => !c.parent_id);
  const subCats = categories.filter((c) => c.parent_id === form.category_id);
  const brandName = brands.find((b: any) => b.id === form.brand_id)?.name ?? "Sem marca";
  const primaryImage = useMemo(() => (form.images ?? []).find((img) => img.is_primary)?.url || (form.images ?? [])[0]?.url || "", [form.images]);

  const qualityItems = [
    { label: "Código interno", ok: Boolean(form.internal_code) },
    { label: "Código fabricante", ok: Boolean(form.manufacturer_code) },
    { label: "Marca", ok: Boolean(form.brand_id) },
    { label: "Categoria", ok: Boolean(form.category_id) },
    { label: "Imagem", ok: Boolean((form.images ?? []).some((img) => img.url.trim())) },
  ];
  const qualityDone = qualityItems.filter((item) => item.ok).length;

  function update<K extends keyof ProductInput>(key: K, value: ProductInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function updateImg(i: number, patch: Partial<Img>) {
    setForm((f) => {
      const imgs = [...(f.images ?? [])];
      imgs[i] = { ...imgs[i], ...patch };
      return { ...f, images: imgs };
    });
    setDirty(true);
  }

  function addImg() {
    setForm((f) => ({ ...f, images: [...(f.images ?? []), { url: "", alt: "", is_primary: (f.images ?? []).length === 0 }] }));
    setDirty(true);
  }

  function removeImg(i: number) {
    setForm((f) => ({ ...f, images: (f.images ?? []).filter((_, idx) => idx !== i) }));
    setDirty(true);
  }

  function moveImg(i: number, dir: -1 | 1) {
    setForm((f) => {
      const imgs = [...(f.images ?? [])];
      const j = i + dir;
      if (j < 0 || j >= imgs.length) return f;
      [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      return { ...f, images: imgs };
    });
    setDirty(true);
  }

  function setPrimary(i: number) {
    setForm((f) => ({ ...f, images: (f.images ?? []).map((img, idx) => ({ ...img, is_primary: idx === i })) }));
    setDirty(true);
  }

  function cancel() {
    if (dirty && typeof window !== "undefined" && !window.confirm("Há alterações não salvas. Deseja sair mesmo assim?")) return;
    navigate({ to: "/admin/produtos" });
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
        const next = uploaded.map((img, idx) => ({ ...img, is_primary: !hasPrimary && current.length === 0 && idx === 0 }));
        return { ...f, images: [...current, ...next] };
      });
      setDirty(true);
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
      const cleanSku = normalizeCode(form.sku) ?? "";
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
        const duplicate = await checkDup({ data: { internal_code: cleanInternal, excludeId: form.id ?? null } });
        if (duplicate?.duplicate) {
          setDupWarning(`Código interno já usado por ${duplicate.products?.[0]?.name ?? "outro produto"}`);
          setTab("geral");
          throw new Error("Código interno duplicado");
        }
      }

      setDupWarning(null);
      const result = await upsert({ data: payload });
      if (!result?.id) throw new Error("Produto não salvo");
      setDirty(false);
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

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: "geral", label: "Geral", icon: Package },
    { key: "comercial", label: "Comercial", icon: BadgeDollarSign },
    { key: "estoque", label: "Estoque", icon: Boxes },
    { key: "imagens", label: "Imagens", icon: Images, count: (form.images ?? []).filter((img) => img.url.trim()).length },
  ];

  return (
    <div className="mx-auto max-w-[1500px] pb-28">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 px-5 py-5 text-white sm:px-7 sm:py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                {primaryImage ? <img src={primaryImage} alt={form.name || "Produto"} className="h-full w-full object-contain bg-white" /> : <Package className="h-9 w-9 text-white/45" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${form.active ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/25" : "bg-slate-400/15 text-slate-300 ring-1 ring-white/15"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${form.active ? "bg-emerald-300" : "bg-slate-400"}`} />
                    {form.active ? "Ativo" : "Inativo"}
                  </span>
                  {dirty ? <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-200 ring-1 ring-amber-300/25">Alterações não salvas</span> : null}
                </div>
                <h1 className="mt-2 truncate text-xl font-black tracking-tight sm:text-2xl">{form.name || (form.id ? "Produto sem nome" : "Novo produto")}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-300">
                  <span className="inline-flex items-center gap-1.5"><Barcode className="h-4 w-4" /> {form.internal_code || form.sku || "Sem código"}</span>
                  <span className="inline-flex items-center gap-1.5"><Tag className="h-4 w-4" /> {brandName}</span>
                  {form.manufacturer_code ? <span>Fabricante: <strong className="text-white">{form.manufacturer_code}</strong></span> : null}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:min-w-[390px]">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Preço B2C</p>
                <p className="mt-1 text-lg font-black">{money(form.price_b2c)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Estoque</p>
                <p className="mt-1 text-lg font-black">{Number(form.stock ?? 0)}</p>
              </div>
              <div className="col-span-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur sm:col-span-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Cadastro</p>
                <p className="mt-1 text-lg font-black">{qualityDone}/5</p>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 sm:px-5" aria-label="Seções do produto">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${tab === key ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {typeof count === "number" ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === key ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600"}`}>{count}</span> : null}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-5">
        {tab === "geral" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              <SectionCard icon={Package} title="Identificação do produto" description="Informações principais, códigos e classificação comercial.">
                <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
                  <label className="md:col-span-2">
                    <span className="text-sm font-semibold text-slate-700">Nome do produto</span>
                    <input className={fieldClass} value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Ex.: Amortecedor de porta-malas..." />
                  </label>

                  <label>
                    <span className="text-sm font-semibold text-slate-700">SKU</span>
                    <input className={fieldClass} value={form.sku} onChange={(e) => update("sku", e.target.value)} placeholder="Código técnico / legado" />
                    <span className="mt-1.5 block text-xs text-slate-400">Preservado para compatibilidade e integrações.</span>
                  </label>
                  <label>
                    <span className="text-sm font-semibold text-slate-700">Código interno Norte Sul</span>
                    <input className={fieldClass} value={form.internal_code ?? ""} onChange={(e) => update("internal_code", e.target.value)} placeholder="Ex.: AZ-7659" />
                    <span className="mt-1.5 block text-xs text-slate-400">Identificador operacional da loja.</span>
                  </label>
                  <label>
                    <span className="text-sm font-semibold text-slate-700">Código do fabricante</span>
                    <input className={fieldClass} value={form.manufacturer_code ?? ""} onChange={(e) => update("manufacturer_code", e.target.value)} placeholder="Referência original da peça" />
                    <span className="mt-1.5 block text-xs text-slate-400">Usado para enriquecimento e aplicações veiculares.</span>
                  </label>
                  <label>
                    <span className="text-sm font-semibold text-slate-700">Marca</span>
                    <select className={fieldClass} value={form.brand_id ?? ""} onChange={(e) => update("brand_id", e.target.value || null)}>
                      <option value="">Sem marca</option>
                      {brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="text-sm font-semibold text-slate-700">Categoria</span>
                    <select className={fieldClass} value={form.category_id ?? ""} onChange={(e) => { update("category_id", e.target.value || null); update("subcategory_id", null); }}>
                      <option value="">Sem categoria</option>
                      {parentCats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="text-sm font-semibold text-slate-700">Subcategoria</span>
                    <select className={fieldClass} value={form.subcategory_id ?? ""} onChange={(e) => update("subcategory_id", e.target.value || null)} disabled={!form.category_id}>
                      <option value="">Sem subcategoria</option>
                      {subCats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                </div>

                {dupWarning ? (
                  <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div><strong>Código duplicado.</strong><div className="mt-0.5">{dupWarning}</div></div>
                  </div>
                ) : null}

                <button type="button" onClick={() => setAdvancedOpen((v) => !v)} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-950">
                  <ChevronDown className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`} />
                  Campos avançados
                </button>
                {advancedOpen ? (
                  <div className="mt-4 grid gap-5 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                    <label>
                      <span className="text-sm font-semibold text-slate-700">Slug / URL</span>
                      <input className={fieldClass} value={form.slug ?? ""} onChange={(e) => update("slug", e.target.value)} placeholder="Gerado automaticamente" />
                    </label>
                    <label>
                      <span className="text-sm font-semibold text-slate-700">Peso (kg)</span>
                      <input className={fieldClass} type="number" step="0.001" min="0" value={form.weight_kg ?? ""} onChange={(e) => update("weight_kg", e.target.value ? Number(e.target.value) : null)} placeholder="0,000" />
                    </label>
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard icon={Tag} title="Descrição" description="Texto que ajuda a equipe e o cliente a entenderem o produto.">
                <div className="space-y-5">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Descrição curta</span>
                    <input className={fieldClass} value={form.short_description ?? ""} onChange={(e) => update("short_description", e.target.value)} placeholder="Resumo comercial do produto" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Descrição completa</span>
                    <textarea className={`${areaClass} min-h-36 resize-y`} value={form.description ?? ""} onChange={(e) => update("description", e.target.value)} placeholder="Características, materiais, observações e informações relevantes..." />
                  </label>
                </div>
              </SectionCard>
            </div>

            <aside className="space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-slate-950">Qualidade do cadastro</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Campos essenciais para catálogo e operação.</p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-sm font-black text-blue-700">{qualityDone}/5</div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${qualityDone * 20}%` }} />
                </div>
                <div className="mt-4 space-y-2.5">
                  {qualityItems.map((item) => (
                    <div key={item.label} className="flex items-center gap-2 text-sm">
                      {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                      <span className={item.ok ? "text-slate-700" : "font-semibold text-slate-900"}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </section>

              {form.id ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="font-bold text-slate-950">Acesso rápido</h2>
                  <p className="mt-1 text-xs text-slate-500">Continue o saneamento técnico deste item.</p>
                  <button type="button" onClick={() => navigate({ to: "/admin/aplicacoes-veiculares" })} className="mt-4 flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><CarFront className="h-4 w-4" /></div>
                    <div><div className="text-sm font-bold text-slate-900">Aplicações veiculares</div><div className="text-xs text-slate-500">Revisar compatibilidades</div></div>
                  </button>
                </section>
              ) : null}
            </aside>
          </div>
        ) : null}

        {tab === "comercial" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <SectionCard icon={BadgeDollarSign} title="Precificação" description="Valores de venda do varejo e do canal B2B.">
              <div className="grid gap-5 sm:grid-cols-2">
                <label>
                  <span className="text-sm font-semibold text-slate-700">Preço B2C</span>
                  <div className="relative mt-2"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">R$</span><input className={`${fieldClass} mt-0 pl-10`} type="number" step="0.01" min="0" value={form.price_b2c} onChange={(e) => update("price_b2c", Number(e.target.value))} /></div>
                  <span className="mt-1.5 block text-xs text-slate-400">Preço principal exibido ao consumidor.</span>
                </label>
                <label>
                  <span className="text-sm font-semibold text-slate-700">Preço B2B</span>
                  <div className="relative mt-2"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">R$</span><input className={`${fieldClass} mt-0 pl-10`} type="number" step="0.01" min="0" value={form.price_b2b ?? ""} onChange={(e) => update("price_b2b", e.target.value ? Number(e.target.value) : null)} placeholder="Opcional" /></div>
                  <span className="mt-1.5 block text-xs text-slate-400">Base para clientes empresariais.</span>
                </label>
                <label className="sm:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">Preço de comparação</span>
                  <div className="relative mt-2 max-w-sm"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">R$</span><input className={`${fieldClass} mt-0 pl-10`} type="number" step="0.01" min="0" value={form.compare_at_price ?? ""} onChange={(e) => update("compare_at_price", e.target.value ? Number(e.target.value) : null)} placeholder="Preço anterior / referência" /></div>
                </label>
              </div>
            </SectionCard>

            <SectionCard icon={BadgeDollarSign} title="Promoção" description="Configure preço e período promocional quando necessário.">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">Preço promocional</span>
                  <div className="relative mt-2 max-w-sm"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">R$</span><input className={`${fieldClass} mt-0 pl-10`} type="number" step="0.01" min="0" value={form.sale_price_b2c ?? ""} onChange={(e) => update("sale_price_b2c", e.target.value ? Number(e.target.value) : null)} placeholder="Sem promoção" /></div>
                </label>
                <label>
                  <span className="text-sm font-semibold text-slate-700">Início</span>
                  <input className={fieldClass} type="datetime-local" value={toInput(form.sale_starts_at)} onChange={(e) => update("sale_starts_at", e.target.value ? new Date(e.target.value).toISOString() : null)} />
                </label>
                <label>
                  <span className="text-sm font-semibold text-slate-700">Fim</span>
                  <input className={fieldClass} type="datetime-local" value={toInput(form.sale_ends_at)} onChange={(e) => update("sale_ends_at", e.target.value ? new Date(e.target.value).toISOString() : null)} />
                </label>
                <div className="sm:col-span-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  <strong className="text-slate-900">Resumo:</strong> venda normal em {money(form.price_b2c)}{form.sale_price_b2c ? ` • promoção em ${money(form.sale_price_b2c)}` : " • sem promoção configurada"}.
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {tab === "estoque" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
            <SectionCard icon={Boxes} title="Controle de estoque" description="Saldo operacional e nível mínimo para reposição.">
              <div className="grid gap-5 sm:grid-cols-2">
                <label>
                  <span className="text-sm font-semibold text-slate-700">Estoque atual</span>
                  <input className={fieldClass} type="number" min="0" value={form.stock} onChange={(e) => update("stock", Number(e.target.value))} />
                  <span className="mt-1.5 block text-xs text-slate-400">Produtos com estoque positivo permanecem ativos pela regra do ERP.</span>
                </label>
                <label>
                  <span className="text-sm font-semibold text-slate-700">Estoque mínimo</span>
                  <input className={fieldClass} type="number" min="0" value={form.min_stock} onChange={(e) => update("min_stock", Number(e.target.value))} />
                  <span className="mt-1.5 block text-xs text-slate-400">Usado para alertas e reposição.</span>
                </label>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Saldo</p><p className="mt-1 text-2xl font-black text-slate-950">{Number(form.stock ?? 0)}</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Mínimo</p><p className="mt-1 text-2xl font-black text-slate-950">{Number(form.min_stock ?? 0)}</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Situação</p><p className={`mt-1 text-sm font-black ${Number(form.stock ?? 0) <= Number(form.min_stock ?? 0) ? "text-amber-600" : "text-emerald-600"}`}>{Number(form.stock ?? 0) <= Number(form.min_stock ?? 0) ? "REPOR" : "NORMAL"}</p></div>
              </div>
            </SectionCard>

            <SectionCard icon={Package} title="Visibilidade e merchandising" description="Controle onde e como o produto aparece no catálogo.">
              <div className="space-y-3">
                <ToggleRow checked={Boolean(form.active)} onChange={(v) => update("active", v)} title="Produto ativo" description="Disponível para operação e catálogo conforme as demais regras." />
                <ToggleRow checked={Boolean(form.hide_when_out_of_stock)} onChange={(v) => update("hide_when_out_of_stock", v)} title="Ocultar sem estoque" description="Remove do storefront quando o saldo chegar a zero." />
                <ToggleRow checked={Boolean(form.featured)} onChange={(v) => update("featured", v)} title="Destaque" description="Prioriza o produto em áreas de vitrine." />
                <ToggleRow checked={Boolean(form.is_new)} onChange={(v) => update("is_new", v)} title="Lançamento" description="Identifica como novidade no catálogo." />
                <ToggleRow checked={Boolean(form.is_bestseller)} onChange={(v) => update("is_bestseller", v)} title="Mais vendido" description="Pode aparecer nas seções de alta procura." />
                <ToggleRow checked={Boolean(form.is_offer)} onChange={(v) => update("is_offer", v)} title="Oferta" description="Inclui o produto nas áreas promocionais." />
              </div>
            </SectionCard>
          </div>
        ) : null}

        {tab === "imagens" ? (
          <div className="space-y-5">
            <SectionCard icon={ImagePlus} title="Galeria do produto" description="Envie arquivos, importe URLs e defina a imagem principal.">
              <div
                className="flex min-h-40 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center transition hover:border-blue-300 hover:bg-blue-50/40"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm"><Upload className="h-5 w-5" /></div>
                <p className="mt-3 font-bold text-slate-900">Arraste imagens aqui</p>
                <p className="mt-1 text-sm text-slate-500">ou selecione arquivos do computador</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? "Enviando..." : "Selecionar arquivos"}
                  </button>
                  <button type="button" onClick={addImg} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"><Plus className="h-4 w-4" /> Adicionar por URL</button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
              </div>
            </SectionCard>

            {(form.images ?? []).length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
                <Images className="mx-auto h-9 w-9 text-slate-300" />
                <p className="mt-3 font-semibold text-slate-700">Nenhuma imagem cadastrada</p>
                <p className="mt-1 text-sm">Adicione uma imagem real do produto para melhorar o catálogo.</p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {(form.images ?? []).map((img, i) => (
                  <div key={`${i}-${img.url}`} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${img.is_primary ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}>
                    <div className="grid gap-4 p-4 sm:grid-cols-[120px_minmax(0,1fr)]">
                      <div className="relative flex h-28 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100 sm:w-28">
                        {img.url ? <img src={img.url} alt={img.alt ?? form.name} className="h-full w-full object-contain" /> : <Images className="h-7 w-7 text-slate-300" />}
                        {img.is_primary ? <span className="absolute left-2 top-2 rounded-full bg-blue-600 px-2 py-1 text-[10px] font-black uppercase text-white">Principal</span> : null}
                      </div>
                      <div className="min-w-0 space-y-3">
                        <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">URL</span><input className={`${fieldClass} h-10`} placeholder="URL da imagem" value={img.url} onChange={(e) => updateImg(i, { url: e.target.value })} /></label>
                        <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Texto alternativo</span><input className={`${fieldClass} h-10`} placeholder="Descrição da imagem" value={img.alt ?? ""} onChange={(e) => updateImg(i, { alt: e.target.value })} /></label>
                        {!isOwnStorageUrl(img.url) && img.url ? <button type="button" className="text-xs font-bold text-blue-700 hover:text-blue-900" onClick={() => importUrl(i)} disabled={importing}>{importing ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}Copiar para armazenamento oficial</button> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
                      <button type="button" onClick={() => setPrimary(i)} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold ${img.is_primary ? "bg-blue-100 text-blue-800" : "text-slate-600 hover:bg-slate-200"}`}><Star className="h-3.5 w-3.5" /> {img.is_primary ? "Imagem principal" : "Definir como principal"}</button>
                      <div className="flex items-center gap-1">
                        <button type="button" title="Mover para cima" onClick={() => moveImg(i, -1)} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-900"><ArrowUp className="h-4 w-4" /></button>
                        <button type="button" title="Mover para baixo" onClick={() => moveImg(i, 1)} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-900"><ArrowDown className="h-4 w-4" /></button>
                        <button type="button" title="Excluir" onClick={() => removeImg(i)} className="rounded-lg p-2 text-red-500 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:left-[var(--admin-sidebar-width,0px)]">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
          <div className="hidden sm:block">
            <p className="text-sm font-bold text-slate-900">{dirty ? "Alterações não salvas" : "Produto atualizado"}</p>
            <p className="text-xs text-slate-500">{dirty ? "Salve para aplicar as mudanças no catálogo." : "Você pode continuar editando ou voltar para a lista."}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={cancel} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"><X className="h-4 w-4" /> Cancelar</button>
            <button type="button" disabled={saving} onClick={save} className="inline-flex h-11 min-w-[150px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Salvando..." : "Salvar produto"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
