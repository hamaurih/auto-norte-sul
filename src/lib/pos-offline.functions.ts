import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import type { PdvCatalogProduct } from "@/lib/pos.functions";

const PRODUCT_SELECT =
  "id, sku, internal_code, manufacturer_code, name, price_b2c, sale_price_b2c, active, brand:brands(name), images:product_images(url, is_primary, sort_order)";

function primaryImage(images: any[] | null | undefined) {
  const rows = [...(images ?? [])].sort(
    (a: any, b: any) =>
      Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) ||
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
  );
  return rows[0]?.url ?? null;
}

/**
 * Snapshot do catálogo disponível no depósito para contingência do PDV.
 * É chamado em background enquanto há conexão e salvo no IndexedDB do terminal.
 * Somente produtos ativos e com saldo disponível entram no snapshot.
 */
export const listPdvOfflineCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { warehouseId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const { data: membership } = await sb
      .from("tenant_memberships")
      .select("id")
      .eq("tenant_id", context.tenantId)
      .eq("user_id", context.userId)
      .eq("active", true)
      .maybeSingle();

    if (!membership) {
      throw new Error("Usuário sem acesso ativo a esta empresa");
    }

    const pageSize = 1000;
    const maxRows = 20_000;
    const rows: any[] = [];

    for (let from = 0; from < maxRows; from += pageSize) {
      const { data: page, error } = await sb
        .from("product_stock")
        .select(
          `product_id, on_hand, reserved, product:products(${PRODUCT_SELECT})`,
        )
        .eq("tenant_id", context.tenantId)
        .eq("warehouse_id", data.warehouseId)
        .gt("on_hand", 0)
        .range(from, from + pageSize - 1);

      if (error) throw new Error(error.message);
      rows.push(...(page ?? []));
      if ((page ?? []).length < pageSize) break;
    }

    return rows
      .map((row: any) => {
        const product = row.product ?? {};
        const stock = Math.max(
          0,
          Number(row.on_hand ?? 0) - Number(row.reserved ?? 0),
        );
        return {
          id: product.id,
          sku: product.sku,
          internal_code: product.internal_code ?? null,
          manufacturer_code: product.manufacturer_code ?? null,
          name: product.name,
          brand: product.brand?.name ?? null,
          image_url: primaryImage(product.images),
          price_b2c: Number(product.price_b2c ?? 0),
          sale_price_b2c:
            product.sale_price_b2c == null
              ? null
              : Number(product.sale_price_b2c),
          stock,
          active: Boolean(product.active),
        };
      })
      .filter((product: any) => product.active && product.stock > 0)
      .map(
        ({ active: _active, ...product }: any) => product,
      ) as PdvCatalogProduct[];
  });
