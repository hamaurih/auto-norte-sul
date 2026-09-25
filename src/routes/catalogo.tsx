import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { fetchBrands, fetchCatalog, fetchCatalogTaxonomy, type CatalogFilters } from "@/lib/queries";
import { ProductCard } from "@/components/site/ProductCard";
import { useSession } from "@/lib/session";
import { useCompanyProfile } from "@/lib/company";
import { ChevronDown, ChevronRight, Filter, FolderTree } from "lucide-react";

type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
};

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
      { title: "CatÃ¡logo Â· Norte Sul AcessÃ³rios" },
      { name: "description", content: "Todo o catÃ¡logo Norte Sul: acessÃ³rios automotivos com filtros por categoria, marca, preÃ§o e aplicaÃ§Ã£o." },
    ],
  }),
  component: Catalog,
});

function Catalog() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { isB2BApproved } = useSession();
  const { data: company } = useCompanyProfile();
  const tenantId = company?.tenant_id;
  const [openFilters, setOpenFilters] = useState(false);

  const filters: CatalogFilters = {
    q: search.q,
    category: search.category,
    brand: search.brand,
    inStock: search.inStock,
    sort: search.sort ?? "sales",
  };
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["catalog", tenantId, filters],
    queryFn: () => fetchCatalog(filters, tenantId),
    enabled: Boolean(tenantId),
  });
  // Taxonomy lists are tenant-scoped: without the tenant id in the key/filter
  // other tenants' categories/brands leak in and appear duplicated.
  const { data: categories = [] } = useQuery({
    queryKey: ["catalog-taxonomy", tenantId],
    queryFn: () => fetchCatalogTaxonomy(tenantId),
    enabled: Boolean(tenantId),
  });
  const { data: brands = [] } = useQuery({
    queryKey: ["brands", tenantId],
    queryFn: () => fetchBrands(tenantId),
    enabled: Boolean(tenantId),
  });

  function update(patch: Partial<typeof search>) {
    navigate({ search: { ...search, ...patch } });
  }

  return (
    <div className="container-x py-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase leading-none">CatÃ¡logo</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Carregando..." : `${products.length} produto(s)`}
            {search.q && <> Â· busca: <b>{search.q}</b></>}
            {search.category && <> Â· categoria: <b>{search.category}</b></>}
            {search.brand && <> Â· marca: <b>{search.brand}</b></>}
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
            <option value="price_asc">Menor preÃ§o</option>
            <option value="price_desc">Maior preÃ§o</option>
            <option value="new">LanÃ§amentos</option>
          </select>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <aside className={`space-y-4 rounded-lg border border-border bg-card p-4 ${openFilters ? "block" : "hidden md:block"}`}>
          <CategoryTree categories={categories} selectedSlug={search.category} onSelect={(category) => update({ category })} />

          <BrandFilter brands={brands} selectedSlug={search.brand} onSelect={(brand) => update({ brand })} />

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

function BrandFilter({
  brands,
  selectedSlug,
  onSelect,
}: {
  brands: { id: string; name: string; slug: string }[];
  selectedSlug?: string;
  onSelect: (brand?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const filteredBrands = useMemo(
    () => normalizedQuery ? brands.filter((brand) => brand.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery)) : brands,
    [brands, normalizedQuery],
  );
  const visibleBrands = normalizedQuery || showAll ? filteredBrands : filteredBrands.slice(0, 8);
  const hasMore = !normalizedQuery && brands.length > 8;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-display text-sm font-bold uppercase">Marcas</h4>
        <span className="text-xs text-muted-foreground">{brands.length}</span>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar marca"
        aria-label="Buscar marca"
        className="mb-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
      <ul className={`space-y-1 text-sm ${showAll || normalizedQuery ? "max-h-56 overflow-y-auto pr-1" : ""}`}>
        <li>
          <button className={`min-h-8 text-left hover:text-primary ${!selectedSlug ? "font-bold text-primary" : ""}`} onClick={() => onSelect(undefined)}>
            Todas as marcas
          </button>
        </li>
        {visibleBrands.map((brand) => (
          <li key={brand.id}>
            <button
              className={`min-h-8 text-left hover:text-primary ${selectedSlug === brand.slug ? "font-bold text-primary" : ""}`}
              onClick={() => onSelect(brand.slug)}
            >
              {brand.name}
            </button>
          </li>
        ))}
        {normalizedQuery && filteredBrands.length === 0 && (
          <li className="py-1 text-xs text-muted-foreground">Nenhuma marca encontrada.</li>
        )}
      </ul>
      {hasMore && (
        <button className="mt-2 text-xs font-semibold text-primary hover:underline" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Mostrar menos" : `Ver mais marcas (${brands.length - 8})`}
        </button>
      )}
    </div>
  );
}

function CategoryTree({
  categories,
  selectedSlug,
  onSelect,
}: {
  categories: CatalogCategory[];
  selectedSlug?: string;
  onSelect: (category?: string) => void;
}) {
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());
  const byParent = useMemo(() => {
    const map = new Map<string, CatalogCategory[]>();
    for (const category of categories) {
      if (!category.parent_id) continue;
      const children = map.get(category.parent_id) ?? [];
      children.push(category);
      map.set(category.parent_id, children);
    }
    return map;
  }, [categories]);
  const departments = categories.filter((category) => !category.parent_id && !category.slug.startsWith("bling-"));
  const selected = categories.find((category) => category.slug === selectedSlug);
  const selectedParent = selected?.parent_id ? categories.find((category) => category.id === selected.parent_id) : null;
  const activeNodes = new Set([selected?.id, selected?.parent_id, selectedParent?.parent_id].filter(Boolean));
  const isOpen = (id: string) => openNodes.has(id) || activeNodes.has(id);
  const toggle = (id: string) => setOpenNodes((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const itemClass = (slug: string, level: "department" | "group" | "subgroup") =>
    `flex min-h-9 flex-1 items-center rounded-md px-2 text-left transition hover:bg-primary/8 hover:text-primary ${
      selectedSlug === slug ? "bg-primary/10 font-bold text-primary" : level === "department" ? "font-semibold text-foreground" : "text-muted-foreground"
    }`;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-display text-sm font-bold uppercase">
        <FolderTree className="size-4 text-primary" /> Categorias
      </div>
      <button className={itemClass("", "department")} onClick={() => onSelect(undefined)}>Todas as categorias</button>
      <ul className="mt-1 space-y-1 text-sm">
        {departments.map((department) => {
          const groups = byParent.get(department.id) ?? [];
          const expanded = isOpen(department.id);
          return (
            <li key={department.id}>
              <div className="flex items-center gap-0.5">
                {groups.length > 0 && (
                  <button
                    className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                    onClick={() => toggle(department.id)}
                    aria-label={`${expanded ? "Recolher" : "Expandir"} ${department.name}`}
                  >
                    {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>
                )}
                <button className={itemClass(department.slug, "department")} onClick={() => onSelect(department.slug)}>{department.name}</button>
              </div>
              {expanded && groups.length > 0 && (
                <ul className="ml-5 border-l border-border pl-2">
                  {groups.map((group) => {
                    const subgroups = byParent.get(group.id) ?? [];
                    const groupExpanded = isOpen(group.id);
                    return (
                      <li key={group.id} className="mt-0.5">
                        <div className="flex items-center gap-0.5">
                          {subgroups.length > 0 && (
                            <button
                              className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
                              onClick={() => toggle(group.id)}
                              aria-label={`${groupExpanded ? "Recolher" : "Expandir"} ${group.name}`}
                            >
                              {groupExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                            </button>
                          )}
                          <button className={itemClass(group.slug, "group")} onClick={() => onSelect(group.slug)}>{group.name}</button>
                        </div>
                        {groupExpanded && subgroups.length > 0 && (
                          <ul className="ml-5 border-l border-border/70 py-0.5 pl-2">
                            {subgroups.map((subgroup) => (
                              <li key={subgroup.id}>
                                <button className={itemClass(subgroup.slug, "subgroup")} onClick={() => onSelect(subgroup.slug)}>{subgroup.name}</button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
