import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { brl } from "@/lib/format";
import {
  generateMissingInternalCodes,
  productDelete,
  productDuplicate,
  productToggle,
} from "@/lib/products.functions";
import { getAdminProductFilters, listAdminProductsFast } from "@/lib/product-list.functions";
import { code128Barcode } from "@/lib/code128";
import { ProductCodeBadges } from "@/components/admin/ProductCodeBadges";
import {
  Barcode,
  ChevronLeft,
  ChevronRight,
  Copy,
  ImageOff,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/produtos/")({
  head: () => ({ meta: [{ title: "Produtos · Admin" }] }),
  component: ProductsList,
});

function Code128Label({ value }: { value: string }) {
  const barcode = code128Barcode(value);
  if (!barcode) return null;
  return (
    <svg
      className="mt-2 h-12 w-full"
      viewBox={`0 0 ${barcode.width} 48`}
      role="img"
      aria-label={`Código de barras ${value}`}
      preserveAspectRatio="none"
    >
      <rect width={barcode.width} height="48" fill="white" />
      {barcode.bars.map((bar, index) => (
        <rect key={index} x={bar.x} y="2" width={bar.width} height="38" fill="black" />
      ))}
    </svg>
  );
}

function ProductsList() {
  const qc = useQueryClient();
  const del = useServerFn(productDelete);
  const dup = useServerFn(productDuplicate);
  const toggle = useServerFn(productToggle);
  const generateCodes = useServerFn(generateMissingInternalCodes);
  const listProducts = useServerFn(listAdminProductsFast);
  const listFilters = useServerFn(getAdminProductFilters);

  const [generatedCodes, setGeneratedCodes] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterActive, setFilterActive] = useState<"" | "true" | "false">("");
  const [filterStock, setFilterStock] = useState<"" | "in" | "out">("");
  const [filterPhoto, setFilterPhoto] = useState<"" | "with" | "without">("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filterCat, filterBrand, filterActive, filterStock, filterPhoto, pageSize]);

  const filtersQuery = useQuery({
    queryKey: ["admin-product-filters"],
    queryFn: () => listFilters(),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });

  const productQueryKey = [
    "admin-products-fast",
    debouncedQ,
    filterCat,
    filterBrand,
    filterActive,
    filterStock,
    pageSize,
    page,
  ] as const;

  const loadPage = (pageToLoad: number) =>
    listProducts({
      data: {
        search: debouncedQ,
        categoryId: filterCat || undefined,
        brandId: filterBrand || undefined,
        active: filterActive,
        stock: filterStock,
        page: pageToLoad,
        pageSize,
      },
    });

  const productsQuery = useQuery({
    queryKey: productQueryKey,
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
    gcTime: 20 * 60_000,
    queryFn: () => loadPage(page),
  });

  const data = productsQuery.data ?? { rows: [], total: 0 };
  const brands = filtersQuery.data?.brands ?? [];
  const cats = filtersQuery.data?.cats ?? [];

  const filteredRows = useMemo(() => {
    const rows = data.rows ?? [];
    if (!filterPhoto) return rows;
    return rows.filter((p: any) => (filterPhoto === "with" ? Boolean(p.image_url) : !p.image_url));
  }, [data.rows, filterPhoto]);

  const rows = filteredRows;
  const total = filterPhoto ? rows.length : data.total ?? 0;
  const totalPages = Math.max(1, Math.ceil((data.total ?? 0) / pageSize));

  useEffect(() => {
    if (!productsQuery.data) return;
    if (page >= totalPages) return;
    const nextPage = page + 1;
    qc.prefetchQuery({
      queryKey: [
        "admin-products-fast",
        debouncedQ,
        filterCat,
        filterBrand,
        filterActive,
        filterStock,
        pageSize,
        nextPage,
      ],
      staleTime: 2 * 60_000,
      queryFn: () => loadPage(nextPage),
    });
  }, [productsQuery.data, page, totalPages, debouncedQ, filterCat, filterBrand, filterActive, filterStock, pageSize]);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir "${name}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await del({ data: { id } });
      toast.success("Produto excluído");
      await qc.invalidateQueries({ queryKey: ["admin-products-fast"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function handleDuplicate(id: string) {
    try {
      await dup({ data: { id } });
      toast.success("Produto duplicado");
      await qc.invalidateQueries({ queryKey: ["admin-products-fast"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function handleToggle(
    id: string,
    field: "active" | "featured" | "is_new" | "is_bestseller",
    value: boolean,
  ) {
    try {
      await toggle({ data: { id, field, value } });
      await qc.invalidateQueries({ queryKey: ["admin-products-fast"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function handleGenerateCodes() {
    try {
      const result = await generateCodes({ data: { limit: 200 } });
      setGeneratedCodes(result.rows ?? []);
      toast.success(
        result.generated
          ? `${result.generated} código(s) interno(s) gerado(s)`
          : "Não há produtos sem código interno",
      );
      await qc.invalidateQueries({ queryKey: ["admin-products-fast"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar os códigos");
    }
  }

  return (
    <div>
      <header className="admin-page-hero mb-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">Catálogo inteligente</p>
          <div className="flex items-center gap-2">
            <h1 className="mt-1 font-display text-3xl font-bold">
              Produtos <span className="text-base text-muted-foreground">({data.total ?? 0})</span>
            </h1>
            {productsQuery.isFetching && !productsQuery.isLoading ? (
              <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Atualizando
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre, filtre e mantenha códigos, imagens, preços e estoque organizados.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleGenerateCodes}
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-violet-200 bg-white px-4 py-2 text-sm font-extrabold text-violet-700 shadow-sm hover:bg-violet-50"
          >
            <Barcode className="h-4 w-4" /> Gerar códigos internos
          </button>
          <Link
            to="/admin/produtos/novo"
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-extrabold text-white shadow-lg shadow-blue-500/20 transition-transform hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" /> Novo Produto
          </Link>
        </div>
      </header>

      <div className="admin-filter-bar mb-4 grid gap-2 md:grid-cols-5 print:hidden">
        <div className="relative md:col-span-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, código interno, código do fabricante ou SKU"
            className="w-full rounded border border-border bg-background p-2 pl-8 text-sm"
          />
        </div>
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="rounded border border-border bg-background p-2 text-sm"
        >
          <option value="">Todas categorias</option>
          {cats.filter((c: any) => !c.parent_id).map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filterBrand}
          onChange={(e) => setFilterBrand(e.target.value)}
          className="rounded border border-border bg-background p-2 text-sm"
        >
          <option value="">Todas marcas</option>
          {brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="flex gap-2">
          <select
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value as "" | "true" | "false")}
            className="flex-1 rounded border border-border bg-background p-2 text-sm"
          >
            <option value="">Ativos/Inativos</option>
            <option value="true">Somente ativos</option>
            <option value="false">Somente inativos</option>
          </select>
          <select
            value={filterStock}
            onChange={(e) => setFilterStock(e.target.value as "" | "in" | "out")}
            className="flex-1 rounded border border-border bg-background p-2 text-sm"
          >
            <option value="">Estoque</option>
            <option value="in">Em estoque</option>
            <option value="out">Sem estoque</option>
          </select>
          <select
            value={filterPhoto}
            onChange={(e) => setFilterPhoto(e.target.value as "" | "with" | "without")}
            className="flex-1 rounded border border-border bg-background p-2 text-sm"
            title="Filtrar por foto"
          >
            <option value="">Foto</option>
            <option value="with">Com foto</option>
            <option value="without">Sem foto</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border/70 bg-card shadow-sm print:hidden">
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
              const thumb = p.image_url ?? null;
              return (
                <tr key={p.id} className="border-t border-border hover:bg-muted/40">
                  <td className="p-2 text-center">
                    {thumb ? (
                      <img src={thumb} alt="" loading="lazy" decoding="async" className="mx-auto h-10 w-10 rounded bg-muted object-cover" />
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
                  <td className={`p-2 text-right ${p.stock === 0 ? "font-bold text-destructive" : ""}`}>{p.stock}</td>
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
            {productsQuery.isLoading ? (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Carregando produtos…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Nenhum produto encontrado.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm print:hidden">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Mostrar</span>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="rounded border border-border bg-background p-1 text-sm">
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
          <span className="text-muted-foreground">por página</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {total === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, data.total ?? 0)}`} de {data.total ?? 0}
          </span>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
          </button>
          <span className="font-semibold">Página {page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 disabled:opacity-40"
          >
            Próxima <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {generatedCodes.length > 0 && (
        <section className="mt-6 rounded-3xl border border-violet-200 bg-white p-5 shadow-sm print:mt-0 print:border-0 print:p-0 print:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-violet-700">Etiquetas geradas</p>
              <h2 className="mt-1 font-display text-xl font-extrabold">Imprima e cole nos produtos</h2>
              <p className="mt-1 text-sm text-muted-foreground">O leitor poderá bipar o código interno, SKU ou GTIN na conferência.</p>
            </div>
            <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-violet-600 px-4 text-sm font-extrabold text-white hover:bg-violet-700">
              <Printer className="h-4 w-4" /> Imprimir etiquetas
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:mt-0 print:grid-cols-3">
            {generatedCodes.map((product) => (
              <article key={product.product_id} className="rounded-2xl border border-border bg-white p-3 print:break-inside-avoid">
                <p className="truncate text-xs font-extrabold">{product.name}</p>
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">SKU {product.sku}</p>
                <Code128Label value={product.internal_code} />
                <p className="mt-1 text-center font-mono text-sm font-extrabold tracking-widest">{product.internal_code}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
