import { createServerFn } from "@tanstack/react-start";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { slugify } from "@/lib/format";

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

// -------- BRANDS --------
export type BrandInput = {
  id?: string | null;
  name: string;
  slug?: string | null;
  logo_url?: string | null;
  featured?: boolean;
};

export const brandUpsert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: BrandInput) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireCatalogTenant(tdb(context.supabase), context.userId, context.tenantId);
    const name = data.name.trim();
    if (!name) throw new Error("Nome obrigatório");
    const slug = (data.slug && data.slug.trim()) || slugify(name);
    const row = {
      tenant_id: membership.tenant_id,
      name,
      slug,
      logo_url: data.logo_url ?? null,
      featured: data.featured ?? false,
    };
    if (data.id) {
      const { error } = await tdb(context.supabase).from("brands").update(row).eq("id", data.id).eq("tenant_id", membership.tenant_id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await tdb(context.supabase).from("brands").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins.id };
  });

export const brandDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireCatalogTenant(tdb(context.supabase), context.userId, context.tenantId);
    const { count } = await tdb(context.supabase)
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("brand_id", data.id)
      .eq("tenant_id", membership.tenant_id);
    if ((count ?? 0) > 0) throw new Error(`Marca em uso por ${count} produto(s). Reatribua antes de excluir.`);
    const { error } = await tdb(context.supabase).from("brands").delete().eq("id", data.id).eq("tenant_id", membership.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- CATEGORIES --------
export type CategoryInput = {
  id?: string | null;
  name: string;
  slug?: string | null;
  parent_id?: string | null;
  icon?: string | null;
  image_url?: string | null;
  sort_order?: number;
  active?: boolean;
};

export const categoryUpsert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CategoryInput) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireCatalogTenant(tdb(context.supabase), context.userId, context.tenantId);
    const name = data.name.trim();
    if (!name) throw new Error("Nome obrigatório");
    const slug = (data.slug && data.slug.trim()) || slugify(name);
    const row = {
      tenant_id: membership.tenant_id,
      name,
      slug,
      parent_id: data.parent_id || null,
      icon: data.icon ?? null,
      image_url: data.image_url ?? null,
      sort_order: data.sort_order ?? 0,
      active: data.active ?? true,
    };
    if (data.id) {
      if (row.parent_id === data.id) throw new Error("Categoria não pode ser pai dela mesma");
      const { error } = await tdb(context.supabase).from("categories").update(row).eq("id", data.id).eq("tenant_id", membership.tenant_id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await tdb(context.supabase).from("categories").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins.id };
  });

export const categoryDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireCatalogTenant(tdb(context.supabase), context.userId, context.tenantId);
    const [{ count: prodCount }, { count: childCount }] = await Promise.all([
      tdb(context.supabase).from("products").select("id", { count: "exact", head: true }).or(`category_id.eq.${data.id},subcategory_id.eq.${data.id}`).eq("tenant_id", membership.tenant_id),
      tdb(context.supabase).from("categories").select("id", { count: "exact", head: true }).eq("parent_id", data.id).eq("tenant_id", membership.tenant_id),
    ]);
    if ((prodCount ?? 0) > 0) throw new Error(`Categoria em uso por ${prodCount} produto(s).`);
    if ((childCount ?? 0) > 0) throw new Error(`Categoria possui ${childCount} subcategoria(s). Exclua-as primeiro.`);
    const { error } = await tdb(context.supabase).from("categories").delete().eq("id", data.id).eq("tenant_id", membership.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
