import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupplyRole } from "./supplies.server";
import type { TaxProduct, TaxProfile } from "./tax-product-scenarios";

export const getTaxCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = tdb(context.supabase);
    await requireSupplyRole(db, context.userId, context.tenantId, ["owner", "admin"]);
    const products: Omit<TaxProduct, "profile">[] = [];
    const profiles = new Map<string, TaxProfile>();
    // Paginate both sources: the Supabase default response cap must not truncate the catalog.
    for (let offset = 0; ; offset += 500) {
      const result = await db
        .from("products")
        .select("id,name,sku,price_b2c,price_b2b,average_cost")
        .eq("tenant_id", context.tenantId)
        .is("deleted_at", null)
        .order("id")
        .range(offset, offset + 499);
      if (result.error) throw new Error(result.error.message);
      products.push(...(result.data ?? []));
      if ((result.data ?? []).length < 500) break;
    }
    for (let offset = 0; ; offset += 500) {
      const result = await db
        .from("product_fiscal_profiles")
        .select(
          "product_id,ncm,cest,icms_cst,icms_csosn,icms_rate,pis_cst,cofins_cst,pis_rate,cofins_rate",
        )
        .eq("tenant_id", context.tenantId)
        .order("product_id")
        .range(offset, offset + 499);
      if (result.error) throw new Error(result.error.message);
      for (const row of result.data ?? []) profiles.set(row.product_id, row);
      if ((result.data ?? []).length < 500) break;
    }
    return products.map((p) => ({ ...p, profile: profiles.get(p.id) ?? null }));
  });
