import { createServerFn } from "@tanstack/react-start";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { normalizeCode, normalizeName } from "@/lib/product-codes";

async function requireCatalogTenant(supabase: any, userId: string, tenantId: string) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: string }) =>
    ["owner", "admin", "manager", "stock"].includes(item.role),
  );
  if (!membership) throw new Error("Usuário sem permissão para administrar o catálogo");
  return membership as { tenant_id: string; role: string };
}

export type ProductInput = {
  id?: string | null;
  sku: string;
  internal_code?: string | null;
  manufacturer_code?: string | null;
  name: string;
  slug: string;
  short_description?: string | null;
  description?: string | null;
  brand_id?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  price_b2c: number;
  price_b2b?: number | null;
  compare_at_price?: number | null;
  sale_price_b2c?: number | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  stock: number;
  min_stock?: number;
  hide_when_out_of_stock?: boolean;
  active?: boolean;
  featured?: boolean;
  is_new?: boolean;
  is_bestseller?: boolean;
  is_offer?: boolean;
  weight_kg?: number | null;
  images?: { url: string; alt?: string | null; is_primary?: boolean }[];
};

export const productUpsert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ProductInput) => input)
  .handler(async ({ data, context }) => {
    const { supabase: rawSupabase, userId } = context;
    const supabase = tdb(rawSupabase);
    const membership = await requireCatalogTenant(supabase, userId, context.tenantId);
    const { images, id, ...row } = data;
    const name = normalizeName(row.name);
    if (!name) throw new Error("Nome do produto é obrigatório");
    const payload = {
      ...row,
      name,
      sku: normalizeCode(row.sku) ?? row.sku,
      internal_code: normalizeCode(row.internal_code),
      manufacturer_code: normalizeCode(row.manufacturer_code),
      tenant_id: membership.tenant_id,
      updated_at: new Date().toISOString(),
    };
    let productId = id;
    if (id) {
      const { error } = await supabase.from("products").update(payload).eq("id", id).eq("tenant_id", membership.tenant_id).is("deleted_at", null);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabase.from("products").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      productId = inserted.id;
    }
    // Replace images
    if (images && productId) {
      await supabase.from("product_images").delete().eq("product_id", productId).eq("tenant_id", membership.tenant_id);
      if (images.length > 0) {
        const rows = images.map((img, i) => ({
          product_id: productId!,
          tenant_id: membership.tenant_id,
          url: img.url,
          alt: img.alt ?? null,
          is_primary: img.is_primary ?? i === 0,
          sort_order: i,
        }));
        const { error } = await supabase.from("product_images").insert(rows);
        if (error) throw new Error(error.message);
      }
    }
    return { ok: true, id: productId };
  });

export const productDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireCatalogTenant(tdb(context.supabase), context.userId, context.tenantId);
    const { error } = await tdb(context.supabase)
      .from("products")
      .update({ deleted_at: new Date().toISOString(), active: false } as any)
      .eq("id", data.id)
      .eq("tenant_id", membership.tenant_id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const productToggle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; field: "active" | "featured" | "is_new" | "is_bestseller" | "is_offer"; value: boolean }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireCatalogTenant(tdb(context.supabase), context.userId, context.tenantId);
    const patch: Record<string, boolean> = { [data.field]: data.value };
    const { error } = await tdb(context.supabase).from("products").update(patch as never).eq("id", data.id).eq("tenant_id", membership.tenant_id).is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const productDuplicate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireCatalogTenant(tdb(context.supabase), context.userId, context.tenantId);
    const { data: src, error } = await tdb(context.supabase)
      .from("products")
      .select("*")
      .eq("id", data.id)
      .eq("tenant_id", membership.tenant_id)
      .is("deleted_at", null)
      .eq("active", true)
      .single();
    if (error || !src) throw new Error(error?.message ?? "Produto não encontrado");
    const suffix = Math.random().toString(36).slice(2, 6);
    const { id: _id, created_at: _c, updated_at: _u, sales_count: _s, bling_id: _b, ...rest } = src as any;
    const copy = {
      ...rest,
      sku: `${src.sku}-COPY-${suffix}`,
      slug: `${src.slug}-copy-${suffix}`,
      name: `${src.name} (cópia)`,
      active: false,
    };
    const { data: inserted, error: insErr } = await tdb(context.supabase).from("products").insert(copy).select("id").single();
    if (insErr) throw new Error(insErr.message);
    // Copy images
    const { data: imgs } = await tdb(context.supabase).from("product_images").select("url, alt, is_primary, sort_order").eq("product_id", data.id).eq("tenant_id", membership.tenant_id);
    if (imgs && imgs.length > 0) {
      await tdb(context.supabase).from("product_images").insert(imgs.map((i) => ({ ...i, product_id: inserted.id, tenant_id: membership.tenant_id })));
    }
    return { ok: true, id: inserted.id };
  });

/**
 * Aviso (não bloqueio) de possível duplicidade do código interno no mesmo tenant.
 * O código do fabricante pode repetir entre marcas — por isso não é verificado.
 */
export const checkInternalCodeDuplicate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { internal_code: string; excludeId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const code = normalizeCode(data.internal_code);
    if (!code) return { duplicate: false, products: [] as { id: string; name: string; sku: string }[] };
    const membership = await requireCatalogTenant(tdb(context.supabase), context.userId, context.tenantId);
    let q = tdb(context.supabase)
      .from("products")
      .select("id, name, sku")
      .eq("tenant_id", membership.tenant_id)
      .eq("internal_code", code)
      .is("deleted_at", null)
      .limit(5);
    if (data.excludeId) q = q.neq("id", data.excludeId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { duplicate: (rows ?? []).length > 0, products: rows ?? [] };
  });
