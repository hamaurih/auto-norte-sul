import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { productDelete, productDuplicate, productToggle } from "@/lib/products.functions";
import { buildProductSearchFilter } from "@/lib/product-codes";
import { ProductCodeBadges } from "@/components/admin/ProductCodeBadges";
import { Plus, Pencil, Copy, Trash2, Search, ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/produtos/")({
  head: () => ({ meta: [{ title: "Produtos · Admin" }] }),
  component: ProductsList,
});

function ProductsList() {
  const qc = useQueryClient();
  const del = useServerFn(productDelete);
  const dup = useServerFn(productDuplicate);
  const toggle = useServerFn(productToggle);
  const [q, setQ] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterActive, setFilterActive] = useState<"" | "true" | "false">("");
  const [filterStock, setFilterStock] = useState<"" | "in" | "out">("");
  const [filterPhoto, setFilterPhoto] = useState<"" | "with" | "without">("");
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);

  // reset page when filters change
  useEffect(() => { setPage(1); }, [q, filterCat, filterBrand, filterActive, filterStock, filterPhoto, pageSize]);

  const { data: brands = [] } = useQuery({ queryKey: ["brands-all"], queryFn: async () => (await supabase.from("brands").select("id,name").order("name")).data ?? [] });
  const { data: cats = [] } = useQuery({ queryKey: ["categories-all"], queryFn: async () => (await supabase.from("categories").select("id,name,parent_id").order("name")).data ?? [] });

  const { data } = useQuery({
    queryKey: ["admin-products", q, filterCat, filterBrand, filterActive, filterStock, pageSize, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("id, sku, internal_code, manufacturer_code, name, stock, price_b2c, sale_price_b2c, active, featured, is_new, is_bestseller, brand_id, category_id, images:product_images(url, is_primary, sort_order)", { count: "exact" })
        .order("name");
      const orFilter = q ? buildProductSearchFilter(q) : null;
      if (orFilter) query = query.or(orFilter);
      if (filterCat) query = query.eq("category_id", filterCat);
      if (filterBrand) query = query.eq("brand_id", filterBrand);
      if (filterActive === "true") query = query.eq("active", true);
      if (filterActive === "false") query = query.eq("active", false);
      if (filterStock === "in") query = query.gt("stock", 0);
      if (filterStock === "out") query = query.lte("stock", 0);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data, count } = await query.range(from, to);
      return { rows: data ?? [], total: count ?? 0 };
    },
  });

  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? [];
    if (!filterPhoto) return rows;
    return rows.filter((p: any) => {
      const hasPhoto = (p.images ?? []).length > 0;
      return filterPhoto === "with" ? hasPhoto : !hasPhoto;
    });
  }, [data, filterPhoto]);

  const rows = filteredRows;
  const total = filterPhoto ? rows.length : (data?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir "${name}"? Essa ação não pode ser desfeita.`)) return;
    try { await del({ data: { id } }); toast.success("Produto excluído"); qc.invalidateQueries({ queryKey: ["admin-products"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }
  async function handleDuplicate(id: string) {
    try { await dup({ data: { id } }); toast.success("Produto duplicado"); qc.invalidateQueries({ queryKey: ["admin-products"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }
  async function handleToggle(id: string, field: "active" | "featured" | "is_new" | "is_bestseller", value: boolean) {
    try { await toggle({ data: { id, field, value } }); qc.invalidateQueries({ queryKey: ["admin-products"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">Catálogo inteligente</p><h1 className="mt-1 font-display text-3xl font-bold">Produtos <span className="text-base text-muted-foreground">({total})</span></h1><p className="mt-1 text-sm text-muted-foreground">Cadastre, filtre e mantenha códigos, imagens, preços e estoque organizados.</p></div>
        <Link to="/admin/produtos/novo" className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-extrabold text-white shadow-lg shadow-blue-500/20 transition-transform hover:-translate-y-0.5">
          <Plus className="h-4 w-4" /> Novo Produto
        </Link>
      </div>

      <div className="mb-3 grid gap-2 md:grid-cols-5">
        <div className="relative md:col-span-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, código interno, código do fabricante ou SKU" className="w-full rounded border border-border bg-background p-2 pl-8 text-sm" />
        </div>
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="rounded border border-border bg-background p-2 text-sm">
          <option value="">Todas categorias</option>
          {cats.filter((c) => !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)} className="rounded border border-border bg-background p-2 text-sm">
          <option value="">Todas marcas</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="flex gap-2">
          <select value={filterActive} onChange={(e) => setFilterActive(e.target.value as "" | "true" | "false")} className="flex-1 rounded border border-border bg-background p-2 text-sm">
            <option value="">Ativos/Inativos</option>
            <option value="true">Somente ativos</option>
            <option value="false">Somente inativos</option>
          </select>
          <select value={filterStock} onChange={(e) => setFilterStock(e.target.value as "" | "in" | "out")} className="flex-1 rounded border border-border bg-background p-2 text-sm">
            <option value="">Estoque</option>
            <option value="in">Em estoque</option>
            <option value="out">Sem estoque</option>
          </select>
          <select value={filterPhoto} onChange={(e) => setFilterPhoto(e.target.value as "" | "with" | "without")} className="flex-1 rounded border border-border bg-background p-2 text-sm" title="Filtrar por foto">
            <option value="">Foto</option>
            <option value="with">Com foto</option>
            <option value="without">Sem foto</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase">
            <tr>
              <th className="p-2 text-center">Foto</th>
              <th className="p-2 text-left">SKU/Bling</th>
              <th className="p-2 text-left">Produto</th>
              <th className="p-2 text-right">Estoque</th>
              <th className="p-2 text-right">Preço</th>
              <th className="p-2 text-center">Ativo</th>
              <th className="p-2 text-center">Destaque</th>
              <th className="p-2 text-center">Lanç.</th>
              <th className="p-2 text-center">Top</th>
              <th className="p-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p: any) => {
              const price = p.sale_price_b2c ? Number(p.sale_price_b2c) : Number(p.price_b2c);
              const imgs = (p.images ?? []).slice().sort(
                (a: any, b: any) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order,
              );
              const thumb = imgs[0]?.url ?? null;
              return (
                <tr key={p.id} className="border-t border-border hover:bg-muted/40">
                  <td className="p-2 text-center">
                    {thumb ? (
                      <img src={thumb} alt="" className="mx-auto h-10 w-10 rounded object-cover bg-muted" />
                    ) : (
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground" title="Sem foto">
                        <ImageOff className="h-4 w-4 opacity-50" />
                      </div>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs text-muted-foreground">{p.sku}</td>
                  <td className="p-2">
                    <div>{p.name}</div>
                    <ProductCodeBadges internalCode={p.internal_code} manufacturerCode={p.manufacturer_code} />
                  </td>
                  <td className={`p-2 text-right ${p.stock === 0 ? "text-destructive font-bold" : ""}`}>{p.stock}</td>
                  <td className="p-2 text-right">{brl(price)}</td>
                  <td className="p-2 text-center"><input type="checkbox" checked={p.active} onChange={(e) => handleToggle(p.id, "active", e.target.checked)} /></td>
                  <td className="p-2 text-center"><input type="checkbox" checked={p.featured} onChange={(e) => handleToggle(p.id, "featured", e.target.checked)} /></td>
                  <td className="p-2 text-center"><input type="checkbox" checked={p.is_new} onChange={(e) => handleToggle(p.id, "is_new", e.target.checked)} /></td>
                  <td className="p-2 text-center"><input type="checkbox" checked={p.is_bestseller} onChange={(e) => handleToggle(p.id, "is_bestseller", e.target.checked)} /></td>
                  <td className="p-2 text-right">
                    <div className="inline-flex gap-1">
                      <Link to="/admin/produtos/$id" params={{ id: p.id }} title="Editar" className="rounded bg-muted p-1.5 hover:bg-primary hover:text-primary-foreground"><Pencil className="h-3.5 w-3.5" /></Link>
                      <button onClick={() => handleDuplicate(p.id)} title="Duplicar" className="rounded bg-muted p-1.5 hover:bg-primary hover:text-primary-foreground"><Copy className="h-3.5 w-3.5" /></button>
                      <button onClick={() => handleDelete(p.id, p.name)} title="Excluir" className="rounded bg-muted p-1.5 hover:bg-destructive hover:text-destructive-foreground"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">Nenhum produto encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Mostrar</span>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="rounded border border-border bg-background p-1 text-sm">
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
          <span className="text-muted-foreground">por página</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {total === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} de {total}
          </span>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
          </button>
          <span className="font-semibold">
            Página {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 disabled:opacity-40"
          >
            Próxima <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
