import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { fetchBrands, fetchCatalog, fetchCategories, type CatalogFilters } from "@/lib/queries";
import { ProductCard } from "@/components/site/ProductCard";
import { useSession } from "@/lib/session";
import { Filter } from "lucide-react";

const searchSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  sort: z.enum(["sales", "price_asc", "price_desc", "new"]).optional(),
  inStock: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/catalogo")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Catálogo · Norte Sul Acessórios" },
      { name: "description", content: "Todo o catálogo Norte Sul: acessórios automotivos com filtros por categoria, marca, preço e aplicação." },
    ],
  }),
  component: Catalog,
});

function Catalog() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { isB2BApproved } = useSession();
  const [openFilters, setOpenFilters] = useState(false);

  const filters: CatalogFilters = {
    q: search.q,
    category: search.category,
    brand: search.brand,
    inStock: search.inStock,
    sort: search.sort ?? "sales",
  };
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["catalog", filters],
    queryFn: () => fetchCatalog(filters),
  });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const { data: brands = [] } = useQuery({ queryKey: ["brands"], queryFn: fetchBrands });

  function update(patch: Partial<typeof search>) {
    navigate({ search: { ...search, ...patch } });
  }

  return (
    <div className="container-x py-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase leading-none">Catálogo</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Carregando..." : `${products.length} produto(s)`}
            {search.q && <> · busca: <b>{search.q}</b></>}
            {search.category && <> · categoria: <b>{search.category}</b></>}
            {search.brand && <> · marca: <b>{search.brand}</b></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold md:hidden" onClick={() => setOpenFilters((v) => !v)}>
            <Filter className="mr-1 inline h-4 w-4" /> Filtros
          </button>
          <select
            value={search.sort ?? "sales"}
            onChange={(e) => update({ sort: e.target.value as CatalogFilters["sort"] })}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="sales">Mais vendidos</option>
            <option value="price_asc">Menor preço</option>
            <option value="price_desc">Maior preço</option>
            <option value="new">Lançamentos</option>
          </select>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <aside className={`space-y-4 rounded-lg border border-border bg-card p-4 ${openFilters ? "block" : "hidden md:block"}`}>
          <div>
            <h4 className="mb-2 font-display text-sm font-bold uppercase">Categorias</h4>
            <ul className="space-y-1 text-sm">
              <li>
                <button className={`hover:text-primary ${!search.category ? "font-bold text-primary" : ""}`} onClick={() => update({ category: undefined })}>
                  Todas
                </button>
              </li>
              {categories.map((c) => (
                <li key={c.id}>
                  <button
                    className={`text-left hover:text-primary ${search.category === c.slug ? "font-bold text-primary" : ""}`}
                    onClick={() => update({ category: c.slug })}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-2 font-display text-sm font-bold uppercase">Marcas</h4>
            <ul className="space-y-1 text-sm">
              <li>
                <button className={`hover:text-primary ${!search.brand ? "font-bold text-primary" : ""}`} onClick={() => update({ brand: undefined })}>
                  Todas
                </button>
              </li>
              {brands.map((b) => (
                <li key={b.id}>
                  <button
                    className={`text-left hover:text-primary ${search.brand === b.slug ? "font-bold text-primary" : ""}`}
                    onClick={() => update({ brand: b.slug })}
                  >
                    {b.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!search.inStock} onChange={(e) => update({ inStock: e.target.checked || undefined })} />
              Apenas em estoque
            </label>
          </div>

          {(search.q || search.category || search.brand || search.inStock) && (
            <Link to="/catalogo" className="block text-xs text-primary hover:underline">Limpar filtros</Link>
          )}
        </aside>

        <div>
          {products.length === 0 && !isLoading && (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
              Nenhum produto encontrado. Tente ajustar os filtros.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <div key={p.id} className="w-full [&>div]:w-full">
                <ProductCard p={p} isB2B={isB2BApproved} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
