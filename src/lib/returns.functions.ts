import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

async function requireInventoryRole(sb: any, userId: string, tenantId: string) {
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);

  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: string }) =>
    ["owner", "admin", "manager", "stock"].includes(item.role),
  );
  if (!membership) throw new Error("Usuário sem permissão para operar devoluções e trocas.");
  return membership as { tenant_id: string; role: string };
}

const returnItemSchema = z.object({
  returned_product_id: z.string().uuid(),
  returned_qty: z.number().int().positive().max(100000),
  condition: z.enum(["resalable", "defective", "quarantine"]),
  resolution: z.enum(["restock", "replace", "quarantine", "supplier_return", "discard"]),
  replacement_product_id: z.string().uuid().optional().nullable(),
  replacement_qty: z.number().int().min(0).max(100000).default(0),
  order_item_id: z.string().uuid().optional().nullable(),
});

const returnSchema = z.object({
  return_type: z.enum(["customer_return", "exchange", "supplier_return", "defective"]),
  warehouse_id: z.string().uuid(),
  order_id: z.string().uuid().optional().nullable(),
  reason: z.string().trim().min(3).max(1000),
  notes: z.string().trim().max(2000).optional().nullable(),
  idempotency_key: z.string().uuid().optional(),
  items: z.array(returnItemSchema).min(1).max(100),
});

export type InventoryReturnInput = z.infer<typeof returnSchema>;

export const listInventoryReturns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireInventoryRole(sb, context.userId, context.tenantId);
    const { data, error } = await sb
      .from("inventory_returns")
      .select("id, return_type, status, order_id, warehouse_id, reason, notes, created_by, completed_by, created_at, completed_at, warehouse:warehouses(name, code)")
      .eq("tenant_id", membership.tenant_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listInventoryQuarantine = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireInventoryRole(sb, context.userId, context.tenantId);
    const { data, error } = await sb
      .from("inventory_quarantine")
      .select("id, return_id, product_id, warehouse_id, quantity, status, reason, created_at, product:products(name, sku), warehouse:warehouses(name, code)")
      .eq("tenant_id", membership.tenant_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const recordInventoryReturn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => returnSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireInventoryRole(sb, context.userId, context.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: returnId, error } = await (supabaseAdmin as any).rpc("record_inventory_return", {
      p_tenant_id: membership.tenant_id,
      p_return_type: data.return_type,
      p_warehouse_id: data.warehouse_id,
      p_reason: data.reason,
      p_items: data.items,
      p_user_id: context.userId,
      p_order_id: data.order_id ?? null,
      p_notes: data.notes ?? null,
      p_idempotency_key: data.idempotency_key ?? crypto.randomUUID(),
    });

    if (error) throw new Error(error.message);
    if (!returnId) throw new Error("A operação não retornou um identificador.");
    return { id: returnId as string };
  });
