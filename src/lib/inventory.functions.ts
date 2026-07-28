import { createServerFn } from "@tanstack/react-start";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireTenantRole(
  sb: any,
  userId: string,
  tenantId: string,
  roles: string[] = ["owner", "admin", "manager"],
) {
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);

  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: string }) => roles.includes(item.role));
  if (!membership) throw new Error("Usuário sem acesso ativo a esta empresa");
  return membership as { tenant_id: string; role: string };
}

// ============ Filiais ============
export const listBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const membership = await requireTenantRole(
      tdb(context.supabase),
      context.userId,
      context.tenantId,
      ["owner", "admin", "manager", "stock", "sales", "cashier", "finance", "accountant", "support", "viewer"],
    );
    const { data, error } = await tdb(context.supabase)
      .from("branches")
      .select("*, warehouses(id, name, code, is_default, active, tenant_id)")
      .eq("tenant_id", membership.tenant_id)
      .order("is_main", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string; name: string; code: string; city?: string | null;
    state?: string | null; address?: string | null; phone?: string | null;
    email?: string | null; is_main?: boolean; active?: boolean;
  }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireTenantRole(tdb(context.supabase), context.userId, context.tenantId);
    const { id, ...row } = data;
    if (id) {
      const { error } = await tdb(context.supabase).from("branches").update(row).eq("id", id).eq("tenant_id", membership.tenant_id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: ins, error } = await tdb(context.supabase).from("branches").insert({ ...row, tenant_id: membership.tenant_id }).select("id").single();
    if (error) throw new Error(error.message);
    // Criar depósito padrão automático
    await tdb(context.supabase).from("warehouses").insert({
      tenant_id: membership.tenant_id,
      branch_id: ins.id,
      name: "Depósito Principal",
      code: `DEP-${row.code}`,
      is_default: true,
      active: true,
    });
    return { ok: true, id: ins.id };
  });

export const upsertWarehouse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; branch_id: string; name: string; code: string; is_default?: boolean; active?: boolean }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireTenantRole(
      tdb(context.supabase),
      context.userId,
      context.tenantId,
      ["owner", "admin", "manager", "stock"],
    );
    const { id, ...row } = data;
    if (id) {
      const { error } = await tdb(context.supabase).from("warehouses").update(row).eq("id", id).eq("tenant_id", membership.tenant_id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: ins, error } = await tdb(context.supabase).from("warehouses").insert({ ...row, tenant_id: membership.tenant_id }).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins.id };
  });

// ============ Estoque ============
export const listStockByProduct = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireTenantRole(
      tdb(context.supabase),
      context.userId,
      context.tenantId,
      ["owner", "admin", "manager", "stock", "sales", "cashier", "finance", "accountant", "support", "viewer"],
    );
    const { data: rows, error } = await tdb(context.supabase)
      .from("product_stock")
      .select("id, warehouse_id, on_hand, reserved, min_stock, warehouse:warehouses(name, code, branch:branches(name, code))")
      .eq("tenant_id", membership.tenant_id)
      .eq("product_id", data.productId);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adjustStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    product_id: string; warehouse_id: string;
    type: "IN" | "OUT" | "ADJUST"; qty: number;
    reference?: string; notes?: string;
  }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireTenantRole(
      tdb(context.supabase),
      context.userId,
      context.tenantId,
      ["owner", "admin", "manager", "stock"],
    );
    const sb = tdb(context.supabase);
    // upsert product_stock row
    const { data: existing } = await sb
      .from("product_stock")
      .select("id, on_hand")
      .eq("tenant_id", membership.tenant_id)
      .eq("product_id", data.product_id)
      .eq("warehouse_id", data.warehouse_id)
      .maybeSingle();
    const delta = data.type === "OUT" ? -Math.abs(data.qty) : data.type === "IN" ? Math.abs(data.qty) : data.qty;
    const newOnHand = data.type === "ADJUST" ? data.qty : Math.max((existing?.on_hand ?? 0) + delta, 0);
    if (existing) {
      const { error } = await sb.from("product_stock").update({ on_hand: newOnHand }).eq("id", existing.id).eq("tenant_id", membership.tenant_id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("product_stock").insert({
        tenant_id: membership.tenant_id,
        product_id: data.product_id, warehouse_id: data.warehouse_id, on_hand: newOnHand,
      });
      if (error) throw new Error(error.message);
    }
    const { error: movementError } = await sb.from("stock_movements").insert({
      tenant_id: membership.tenant_id,
      product_id: data.product_id,
      warehouse_id: data.warehouse_id,
      type: data.type,
      qty: Math.abs(data.qty),
      reference: data.reference ?? null,
      notes: data.notes ?? null,
      user_id: context.userId,
    });
    if (movementError) throw new Error(movementError.message);
    return { ok: true, on_hand: newOnHand };
  });

export const listMovements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { warehouseId?: string; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireTenantRole(
      tdb(context.supabase),
      context.userId,
      context.tenantId,
      ["owner", "admin", "manager", "stock", "sales", "cashier", "finance", "accountant", "support", "viewer"],
    );
    let q = tdb(context.supabase)
      .from("stock_movements")
      .select("id, type, qty, reference, notes, created_at, product:products(sku, name), warehouse:warehouses(name, code)")
      .eq("tenant_id", membership.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.warehouseId) q = q.eq("warehouse_id", data.warehouseId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const stockOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const membership = await requireTenantRole(
      tdb(context.supabase),
      context.userId,
      context.tenantId,
      ["owner", "admin", "manager", "stock", "sales", "cashier", "finance", "accountant", "support", "viewer"],
    );
    const sb = tdb(context.supabase);
    const { data: branches } = await sb.from("branches").select("id, name, code, is_main").eq("tenant_id", membership.tenant_id).eq("active", true);
    const results: { branch: any; total_on_hand: number; total_reserved: number; skus: number }[] = [];
    for (const b of branches ?? []) {
      const { data: whs } = await sb.from("warehouses").select("id").eq("tenant_id", membership.tenant_id).eq("branch_id", b.id);
      const whIds = (whs ?? []).map((w) => w.id);
      if (whIds.length === 0) { results.push({ branch: b, total_on_hand: 0, total_reserved: 0, skus: 0 }); continue; }
      const { data: agg } = await sb
        .from("product_stock")
        .select("on_hand, reserved, product_id")
        .eq("tenant_id", membership.tenant_id)
        .in("warehouse_id", whIds);
      const total_on_hand = (agg ?? []).reduce((s, r) => s + (r.on_hand ?? 0), 0);
      const total_reserved = (agg ?? []).reduce((s, r) => s + (r.reserved ?? 0), 0);
      const skus = new Set((agg ?? []).map((r) => r.product_id)).size;
      results.push({ branch: b, total_on_hand, total_reserved, skus });
    }
    return results;
  });
