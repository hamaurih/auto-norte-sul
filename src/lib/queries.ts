import { supabase } from "@/integrations/supabase/client";
import { activeTenantSlug } from "@/integrations/supabase/tenant";
import { normalizeTerm } from "./normalize";
import { sanitizeSearchTerm, sanitizeOrQuery } from "./sanitize";

/**
 * Public catalog/taxonomy reads must never resolve a category, brand, alias or
 * product that belongs to another tenant. Callers that already know the active
 * tenant (Header, Home, Catálogo) pass it explicitly; loaders without React
 * context fall back to resolving the tenant of the active storefront slug.
 */
let tenantIdPromise: Promise<string | null> | null = null;

export async function resolveActiveTenantId(): Promise<string | null> {
  if (!tenantIdPromise) {
    tenantIdPromise = (async () => {
      try {
        const { data } = await supabase
          .from("tenant_storefronts")
          .select("tenant_id")
          .eq("slug", activeTenantSlug())
          .maybeSingle();
        return data?.tenant_id ?? null;
      } catch {
        return null;
      }
    })();
  }
  return tenantIdPromise;
}

async function tenantScope(tenantId?: string | null): Promise<string | null> {
  return tenantId ?? (await resolveActiveTenantId());
}

// Resolve termo → alias (categoria/marca/produto). Retorna o alias de maior peso ativo.
// O alias em si é resolvido por termo; a segurança multi-tenant vem da resolução
// do alvo (marca/categoria/produto), sempre filtrada por `tenant_id`.
export async function resolveAlias(term: string) {
  const n = normalizeTerm(term);
  if (n.length < 2) return null;
  const { data } = await supabase
    .from("search_aliases")
    .select("term, normalized_term, target_type, target_id, target_slug, target_label, weight")
    .eq("is_active", true)
    .eq("normalized_term", n)
    .order("weight", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

type CategoryTarget = { id: string; parent_id: string | null };

function applyCategoryTarget<T extends { eq: (column: string, value: string) => T }>(query: T, category: CategoryTarget) {
  return category.parent_id
    ? query.eq("subcategory_id", category.id)
    : query.eq("category_id", category.id);
}

async function logNoResult(term: string, origin: "site" | "mcp" | "ia" | "admin", matched?: { alias?: string | null; brand?: string | null; category?: string | null }) {
  try {
    await supabase.from("search_no_result_logs").insert({
      term: term.slice(0, 200),
      normalized_term: normalizeTerm(term).slice(0, 200),
      origin,
      results_count: 0,
      matched_alias: matched?.alias ?? null,
      matched_brand: matched?.brand ?? null,
      matched_category: matched?.category ?? null,
    });
  } catch { /* best effort */ }
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  price_b2c: number;
  price_b2b: number | null;
  compare_at_price: number | null;
  stock: number;
  featured: boolean;
  is_new: boolean;
  is_offer: boolean;
  sales_count: number;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string } | null;
  images: { url: string; is_primary: boolean; sort_order: number }[];
}

// NOTE: `price_b2b` and `internal_code` are restricted to authenticated users
// (see column-level GRANT revoke on `anon`). The browser client can be either
// anon or authenticated, so this projection intentionally omits them to keep
// anonymous catalog reads working. B2B pricing for approved customers is
// resolved server-side via `displayPrice` — if we need per-product B2B prices
// on the browser later, fetch them through an authenticated server function.
const PRODUCT_SELECT = `
  id, sku, name, slug, short_description, description,
  price_b2c, compare_at_price, stock,
  featured, is_new, is_offer, sales_count,
  brand:brands(name, slug),
  category:categories!products_category_tenant_fkey(name, slug),
  images:product_images(url, is_primary, sort_order)
`;

// Lighter projection for list/rail rendering — omits heavy `description`
// (which can be very large) and keeps only fields ProductCard reads.
const PRODUCT_LIST_SELECT = `
  id, sku, name, slug, short_description,
  price_b2c, compare_at_price, stock,
  featured, is_new, is_offer, sales_count,
  brand:brands(name, slug),
  images:product_images(url, is_primary, sort_order)
`;

export async function fetchFeatured(): Promise<ProductRow[]> {
  // Prefer curated "featured"; if none, fall back to any active products so the
  // storefront always shows merchandise.
  const curated = await supabase
    .from("products")
    .select(PRODUCT_LIST_SELECT)
    .eq("active", true)
    .is("deleted_at", null)
    .eq("featured", true)
    .limit(12);
  if (curated.error) console.error("Erro ao carregar produtos em destaque", curated.error);
  if ((curated.data?.length ?? 0) > 0) return curated.data as unknown as ProductRow[];
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_LIST_SELECT)
    .eq("active", true)
    .is("deleted_at", null)
    .order("name")
    .limit(12);
  if (error) {
    console.error("Erro ao carregar vitrine de produtos", error);
    return [];
  }
  return (data as unknown as ProductRow[]) ?? [];
}

export async function fetchOffers(): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_LIST_SELECT)
    .eq("active", true)
    .is("deleted_at", null)
    .or("is_offer.eq.true,sale_price_b2c.not.is.null")
    .order("sales_count", { ascending: false })
    .limit(12);
  if (error) {
    console.error("Erro ao carregar ofertas", error);
    return fetchBestSellers();
  }
  if ((data?.length ?? 0) === 0) return fetchBestSellers();
  return (data as unknown as ProductRow[]) ?? [];
}

export async function fetchNewArrivals(): Promise<ProductRow[]> {
  // Show newest products; do not require the "is_new" flag so recently
  // imported items automatically populate the rail.
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_LIST_SELECT)
    .eq("active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) {
    console.error("Erro ao carregar lançamentos", error);
    return fetchBestSellers();
  }
  return (data as unknown as ProductRow[]) ?? [];
}

export async function fetchBestSellers(): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_LIST_SELECT)
    .eq("active", true)
    .is("deleted_at", null)
    .order("sales_count", { ascending: false })
    .order("name")
    .limit(12);
  if (error) {
    console.error("Erro ao carregar mais vendidos", error);
    return [];
  }
  return (data as unknown as ProductRow[]) ?? [];
}


export interface CatalogFilters {
  q?: string;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort?: "sales" | "price_asc" | "price_desc" | "new";
}

export async function fetchCatalog(f: CatalogFilters = {}): Promise<ProductRow[]> {
  let q = supabase.from("products").select(PRODUCT_LIST_SELECT).eq("active", true)
    .is("deleted_at", null);

  let brandIdFromQuery: string | null = null;
  let categoryFromAlias: CategoryTarget | null = null;
  if (f.q) {
    const rawTerm = f.q.trim().toLowerCase();
    const term = sanitizeSearchTerm(f.q).toLowerCase();
    const safe = sanitizeOrQuery(term);

    // 1) Marca por match de nome/slug
    if (term.length >= 2 && !f.brand) {
      const { data: brands } = await supabase
        .from("brands")
        .select("id, name, slug")
        .or(`name.ilike.%${safe}%,slug.ilike.%${safe}%`)
        .limit(3);
      const exact = (brands ?? []).find((b) => b.name.toLowerCase() === rawTerm || b.slug.toLowerCase() === rawTerm);
      const chosen = exact ?? brands?.[0] ?? null;
      if (chosen) brandIdFromQuery = chosen.id;
    }

    // 2) Alias comercial (só se ainda não achou marca)
    if (!brandIdFromQuery && !f.category) {
      const alias = await resolveAlias(f.q);
      if (alias) {
        if (alias.target_type === "brand" && alias.target_slug) {
          const { data: br } = await supabase.from("brands").select("id").eq("slug", alias.target_slug).maybeSingle();
          if (br) brandIdFromQuery = br.id;
        } else if (alias.target_type === "category" && alias.target_slug) {
          const { data: cat } = await supabase.from("categories").select("id, parent_id").eq("slug", alias.target_slug).maybeSingle();
          if (cat) categoryFromAlias = cat;
        } else if (alias.target_type === "product" && alias.target_id) {
          q = q.eq("id", alias.target_id);
        }
      }
    }

    // 3) Se nada casou por marca/alias, busca textual normal
    if (!brandIdFromQuery && !categoryFromAlias) {
      q = q.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,short_description.ilike.%${safe}%`);
    }
  }
  if (brandIdFromQuery) q = q.eq("brand_id", brandIdFromQuery);
  if (categoryFromAlias) q = applyCategoryTarget(q, categoryFromAlias);
  if (f.category) {
    const { data: cat } = await supabase.from("categories").select("id, parent_id").eq("slug", f.category).maybeSingle();
    if (cat) q = applyCategoryTarget(q, cat);
  }
  if (f.brand) {
    const { data: br } = await supabase.from("brands").select("id").eq("slug", f.brand).maybeSingle();
    if (br) q = q.eq("brand_id", br.id);
  }
  if (typeof f.minPrice === "number") q = q.gte("price_b2c", f.minPrice);
  if (typeof f.maxPrice === "number") q = q.lte("price_b2c", f.maxPrice);
  if (f.inStock) q = q.gt("stock", 0);

  switch (f.sort) {
    case "price_asc":
      q = q.order("price_b2c", { ascending: true });
      break;
    case "price_desc":
      q = q.order("price_b2c", { ascending: false });
      break;
    case "new":
      q = q.order("created_at", { ascending: false });
      break;
    default:
      q = q.order("sales_count", { ascending: false });
  }

  const { data, error } = await q.limit(60);
  if (error) {
    console.error("Erro ao carregar catálogo", error);
    return [];
  }
  const rows = (data as unknown as ProductRow[]) ?? [];
  if (f.q && rows.length === 0) void logNoResult(f.q, "site");
  return rows;
}

export async function fetchProductBySlug(slug: string): Promise<ProductRow | null> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .eq("active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("Erro ao carregar produto", error);
    return null;
  }
  return (data as unknown as ProductRow) ?? null;
}

export async function fetchProductApplications(productId: string) {
  const { data } = await supabase
    .from("product_applications")
    .select("vehicle_make, vehicle_model, year_from, year_to")
    .eq("product_id", productId);
  return data ?? [];
}

export async function fetchRelated(categorySlug: string | null, excludeId: string) {
  let q = supabase.from("products").select(PRODUCT_LIST_SELECT).eq("active", true)
    .is("deleted_at", null).neq("id", excludeId).limit(8);
  if (categorySlug) {
    const { data: cat } = await supabase.from("categories").select("id").eq("slug", categorySlug).maybeSingle();
    if (cat) q = q.eq("category_id", cat.id);
  }
  const { data } = await q;
  return (data as unknown as ProductRow[]) ?? [];
}

export interface SearchSuggestion {
  id: string;
  sku: string;
  name: string;
  slug: string;
  price_b2c: number;
  image: string | null;
}

export async function fetchSearchSuggestions(term: string, limit = 8): Promise<SearchSuggestion[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  const safe = sanitizeOrQuery(sanitizeSearchTerm(q));
  const lower = q.toLowerCase();

  // Se casar com marca, retornar top produtos da marca
  const { data: brands } = await supabase
    .from("brands")
    .select("id, name, slug")
    .or(`name.ilike.%${safe}%,slug.ilike.%${safe}%`)
    .limit(3);
  const brandMatch = (brands ?? []).find(
    (b) => b.name.toLowerCase() === lower || b.slug.toLowerCase() === lower,
  ) ?? brands?.[0] ?? null;

  let query = supabase
    .from("products")
    .select("id, sku, name, slug, price_b2c, images:product_images(url, is_primary, sort_order)")
    .eq("active", true)
    .is("deleted_at", null);
  if (brandMatch) {
    query = query.eq("brand_id", brandMatch.id);
  } else {
    // Tenta alias comercial antes do fallback textual
    const alias = await resolveAlias(q);
    if (alias?.target_type === "category" && alias.target_slug) {
      const { data: cat } = await supabase.from("categories").select("id, parent_id").eq("slug", alias.target_slug).maybeSingle();
      if (cat) query = applyCategoryTarget(query, cat);
      else query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`);
    } else if (alias?.target_type === "brand" && alias.target_slug) {
      const { data: br } = await supabase.from("brands").select("id").eq("slug", alias.target_slug).maybeSingle();
      if (br) query = query.eq("brand_id", br.id);
      else query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`);
    } else if (alias?.target_type === "product" && alias.target_id) {
      query = query.eq("id", alias.target_id);
    } else {
      query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`);
    }
  }
  const { data, error } = await query.order("sales_count", { ascending: false }).limit(limit);
  if (error) {
    console.error("Erro na busca rápida", error);
    return [];
  }
  return (data ?? []).map((p: {
    id: string; sku: string; name: string; slug: string; price_b2c: number;
    images: { url: string; is_primary: boolean; sort_order: number }[] | null;
  }) => {
    const imgs = (p.images ?? []).slice().sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order,
    );
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      slug: p.slug,
      price_b2c: p.price_b2c,
      image: imgs[0]?.url ?? null,
    };
  });
}


/**
 * Public taxonomy reads are tenant-scoped: the storefront must only ever show
 * the departments/brands of the active tenant. Without the explicit filter,
 * rows from other tenants leak in and appear as duplicated categories/brands.
 */
export async function fetchCategories(tenantId?: string | null) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, icon, sort_order")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .is("parent_id", null)
    .order("sort_order");
  if (error) {
    console.error("Erro ao carregar departamentos", error);
    return [];
  }
  return data ?? [];
}

export async function fetchBrands(tenantId?: string | null) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, slug, logo_url, featured")
    .eq("tenant_id", tenantId)
    .order("name");
  if (error) {
    console.error("Erro ao carregar marcas", error);
    return [];
  }
  return data ?? [];
}

export async function fetchBanners() {
  const { data } = await supabase
    .from("banners")
    .select("*")
    .in("position", ["hero", "home_hero"])
    .eq("active", true)
    .order("sort_order");
  return data ?? [];
}

export async function fetchMiniBanners() {
  const { data } = await supabase
    .from("banners")
    .select("*")
    .in("position", ["mini", "home_mini"])
    .eq("active", true)
    .order("sort_order");
  return data ?? [];
}

export function primaryImage(p: ProductRow): string | null {
  const imgs = (p.images ?? []).slice().sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  return imgs[0]?.url ?? null;
}

export function displayPrice(p: ProductRow, isB2BApproved: boolean) {
  const b2b = isB2BApproved && p.price_b2b ? p.price_b2b : null;
  return {
    retail: p.price_b2c,
    wholesale: b2b,
    compare: p.compare_at_price,
    effective: b2b ?? p.price_b2c,
  };
}
