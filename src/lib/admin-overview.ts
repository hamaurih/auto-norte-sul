import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LowStockRow = { key: string; sku: string; name: string; stock: number };

export type AdminOverview = {
  orders: number | null;
  products: number | null;
  customers: number | null;
  b2bPending: number | null;
  criticalStock: number | null;
  outOfStock: number | null;
  lowStock: LowStockRow[];
  /** Which model answered the stock questions. */
  stockSource: "product_stock" | "products" | "unavailable";
  partial: boolean;
};

const CRITICAL_THRESHOLD = 5;

async function count(table: string, apply?: (q: any) => any): Promise<number | null> {
  let query: any = supabase.from(table as never).select("*", { count: "exact", head: true });
  if (apply) query = apply(query);
  const { count: value, error } = await query;
  return error ? null : (value ?? 0);
}

/**
 * Stock reads prefer the tenant-aware `product_stock`/`warehouses` model. The
 * legacy `products.stock` column is only a fallback when no per-warehouse rows
 * are readable, and the UI states which source answered.
 */
async function loadStock(): Promise<
  Pick<AdminOverview, "criticalStock" | "outOfStock" | "lowStock" | "stockSource">
> {
  const modern: any = await supabase
    .from("product_stock" as never)
    .select("id, on_hand, product:products(sku, name)", { count: "exact" })
    .lt("on_hand", CRITICAL_THRESHOLD)
    .order("on_hand", { ascending: true })
    .limit(8);

  if (!modern.error && Array.isArray(modern.data) && modern.data.length > 0) {
    const zero: any = await supabase
      .from("product_stock" as never)
      .select("*", { count: "exact", head: true })
      .lte("on_hand", 0);
    return {
      criticalStock: modern.count ?? modern.data.length,
      outOfStock: zero.error ? null : (zero.count ?? 0),
      stockSource: "product_stock",
      lowStock: modern.data.map((row: any) => ({
        key: row.id as string,
        sku: (row.product?.sku as string) ?? "—",
        name: (row.product?.name as string) ?? "Produto sem cadastro",
        stock: Number(row.on_hand ?? 0),
      })),
    };
  }

  const legacy = await supabase
    .from("products")
    .select("id, sku, name, stock", { count: "exact" })
    .lt("stock", CRITICAL_THRESHOLD)
    .order("stock", { ascending: true })
    .limit(8);

  if (legacy.error) {
    return { criticalStock: null, outOfStock: null, lowStock: [], stockSource: "unavailable" };
  }

  const zero = await count("products", (q) => q.lte("stock", 0));
  return {
    criticalStock: legacy.count ?? legacy.data?.length ?? 0,
    outOfStock: zero,
    stockSource: "products",
    lowStock: (legacy.data ?? []).map((row) => ({
      key: row.id,
      sku: row.sku,
      name: row.name,
      stock: Number(row.stock ?? 0),
    })),
  };
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const [orders, products, customers, b2bPending, stock] = await Promise.all([
    count("orders"),
    count("products"),
    count("profiles"),
    count("b2b_registrations", (q) => q.eq("status", "pendente")),
    loadStock(),
  ]);

  const partial =
    orders === null ||
    products === null ||
    customers === null ||
    b2bPending === null ||
    stock.stockSource === "unavailable";

  return { orders, products, customers, b2bPending, ...stock, partial };
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin-overview"],
    queryFn: fetchAdminOverview,
    staleTime: 30_000,
  });
}
