import { createServerFn } from "@tanstack/react-start";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { buildProductSearchFilter } from "@/lib/product-codes";

export type FastAdminProductsListInput = {
  search?: string;
  categoryId?: string;
  brandId?: string;
  active?: "" | "true" | "false";
  stock?: "" | "in" | "out";
  warehouseId?: string;
  page?: number;
  pageSize?: number;
};

async function requireCatalogTenant(supabase: any, userId: string, tenantId: string) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id,role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !["owner", "admin", "manager", "stock"].includes(data.role)) {
    throw new Error("Usuário sem permissão para administrar o catálogo");
  }
  return data as { tenant_id: string; role: string };
}

export const listAdminProductsFast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: FastAdminProductsListInput) => input ?? {})
  .handler(async ({ data, context }) => {
    const supabase = tdb(context.supabase);
    const membership = await requireCatalogTenant(supabase, context.userId, context.tenantId);
    const tenantId = membership.tenant_id;
    const pageSize = Math.max(1, Math.min(Math.trunc(Number(data.pageSize ?? 50)), 200));
    const page = Math.max(1, Math.trunc(Number(data.page ?? 1)));
    const search = String(data.search ?? "").trim();

    let query = supabase
      .from("products")
      .select(
        "id,sku,internal_code,manufacturer_code,name,stock,price_b2c,sale_price_b2c,active,featured,is_new,is_bestseller,brand_id,category_id",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("name");

    const orFilter = buildProductSearchFilter(search);
    if (orFilter) query = query.or(orFilter);
    if (data.categoryId) query = query.eq("category_id", data.categoryId);
    if (data.brandId) query = query.eq("brand_id", data.brandId);
    if (data.active === "true") query = query.eq("active", true);
    if (data.active === "false") query = query.eq("active", false);
    // O campo legado products.stock representa o saldo geral. Ao escolher um
    // depósito, o filtro de saldo é aplicado depois sobre product_stock dele.
    if (!data.warehouseId && data.stock === "in") query = query.gt("stock", 0);
    if (!data.warehouseId && data.stock === "out") query = query.lte("stock", 0);

    const from = (page - 1) * pageSize;
    const { data: rows, count, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    const productRows = rows ?? [];
    const ids = productRows.map((row: any) => row.id);
    const imageByProduct = new Map<string, string>();

    if (ids.length > 0) {
      const { data: images, error: imageError } = await supabase
        .from("product_images")
        .select("product_id,url,is_primary,sort_order")
        .eq("tenant_id", tenantId)
        .in("product_id", ids)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true });
      if (imageError) throw new Error(imageError.message);
      for (const image of images ?? []) {
        if (!imageByProduct.has(image.product_id)) imageByProduct.set(image.product_id, image.url);
      }
    }

    const stockByProduct = new Map<string, number>();
    if (data.warehouseId && ids.length > 0) {
      const { data: stockRows, error: stockError } = await supabase
        .from("product_stock")
        .select("product_id,on_hand")
        .eq("tenant_id", tenantId)
        .eq("warehouse_id", data.warehouseId)
        .in("product_id", ids);
      if (stockError) throw new Error(stockError.message);
      for (const stockRow of stockRows ?? []) {
        stockByProduct.set(stockRow.product_id, Number(stockRow.on_hand ?? 0));
      }
    }

    return {
      rows: productRows.map((row: any) => ({
        ...row,
        // Sem depósito selecionado, mantém o saldo geral do catálogo. Com um
        // depósito selecionado, o saldo exibido é exclusivamente o dele.
        stock: data.warehouseId ? (stockByProduct.get(row.id) ?? 0) : row.stock,
        image_url: imageByProduct.get(row.id) ?? null,
      })),
      total: count ?? 0,
    };
  });

export const getAdminProductFilters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = tdb(context.supabase);
    const membership = await requireCatalogTenant(supabase, context.userId, context.tenantId);
    const tenantId = membership.tenant_id;

    const [brandsResult, categoriesResult, warehousesResult] = await Promise.all([
      supabase.from("brands").select("id,name").eq("tenant_id", tenantId).order("name"),
      supabase.from("categories").select("id,name,parent_id").eq("tenant_id", tenantId).order("name"),
      supabase.from("warehouses").select("id,name,code,inventory_kind,active").eq("tenant_id", tenantId).eq("active", true).order("name"),
    ]);
    if (brandsResult.error) throw new Error(brandsResult.error.message);
    if (categoriesResult.error) throw new Error(categoriesResult.error.message);
    if (warehousesResult.error) throw new Error(warehousesResult.error.message);

    return {
      brands: brandsResult.data ?? [],
      cats: categoriesResult.data ?? [],
      warehouses: warehousesResult.data ?? [],
    };
  });
