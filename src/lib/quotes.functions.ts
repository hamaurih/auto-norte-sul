import { createServerFn } from "@tanstack/react-start";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireTenantSalesRole(sb: any, userId: string, tenantId: string) {
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: string }) =>
    ["owner", "admin", "manager", "sales"].includes(item.role),
  );
  if (!membership) throw new Error("Usuário sem acesso comercial ativo");
  return membership as { tenant_id: string; role: string };
}

export type QuoteItemInput = {
  product_id?: string | null;
  sku?: string | null;
  name: string;
  qty: number;
  unit_price: number;
  discount?: number;
  notes?: string | null;
};

export type QuoteInput = {
  id?: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  sales_rep_id?: string | null;
  branch_id?: string | null;
  origin?: "whatsapp" | "ia" | "site" | "vendedor" | "balcao" | "b2b";
  status?: "rascunho" | "enviado" | "em_negociacao" | "aprovado" | "recusado" | "convertido" | "expirado";
  discount?: number;
  internal_notes?: string | null;
  customer_notes?: string | null;
  valid_until?: string | null;
  items: QuoteItemInput[];
};

export const listQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireTenantSalesRole(tdb(context.supabase), context.userId, context.tenantId);
    let q = tdb(context.supabase)
      .from("quotes")
      .select("id, number, customer_name, customer_email, origin, status, total, created_at, valid_until")
      .eq("tenant_id", membership.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.status) q = q.eq("status", data.status as any);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireTenantSalesRole(tdb(context.supabase), context.userId, context.tenantId);
    const { data: q, error } = await tdb(context.supabase)
      .from("quotes")
      .select("*, items:quote_items(*)")
      .eq("tenant_id", membership.tenant_id)
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return q;
  });

export const upsertQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: QuoteInput) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireTenantSalesRole(tdb(context.supabase), context.userId, context.tenantId);
    const sb = tdb(context.supabase);
    const items = data.items ?? [];
    const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price - (i.discount ?? 0), 0);
    const total = Math.max(subtotal - (data.discount ?? 0), 0);
    const row = {
      tenant_id: membership.tenant_id,
      customer_id: data.customer_id ?? null,
      customer_name: data.customer_name ?? null,
      customer_email: data.customer_email ?? null,
      customer_phone: data.customer_phone ?? null,
      sales_rep_id: data.sales_rep_id ?? null,
      branch_id: data.branch_id ?? null,
      origin: data.origin ?? "site",
      status: data.status ?? "rascunho",
      subtotal,
      discount: data.discount ?? 0,
      total,
      internal_notes: data.internal_notes ?? null,
      customer_notes: data.customer_notes ?? null,
      valid_until: data.valid_until ?? null,
      created_by: context.userId,
    };
    let quoteId = data.id;
    if (quoteId) {
      const { error } = await sb.from("quotes").update(row).eq("id", quoteId).eq("tenant_id", membership.tenant_id);
      if (error) throw new Error(error.message);
      await sb.from("quote_items").delete().eq("tenant_id", membership.tenant_id).eq("quote_id", quoteId);
    } else {
      const { data: ins, error } = await sb.from("quotes").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      quoteId = ins.id;
    }
    if (items.length > 0) {
      const { error } = await sb.from("quote_items").insert(items.map((i) => ({
        tenant_id: membership.tenant_id,
        quote_id: quoteId!,
        product_id: i.product_id ?? null,
        sku: i.sku ?? null,
        name: i.name,
        qty: i.qty,
        unit_price: i.unit_price,
        discount: i.discount ?? 0,
        total: i.qty * i.unit_price - (i.discount ?? 0),
        notes: i.notes ?? null,
      })));
      if (error) throw new Error(error.message);
    }
    return { ok: true, id: quoteId };
  });

export const setQuoteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: QuoteInput["status"] }) => input)
  .handler(async ({ data, context }) => {
    const membership = await requireTenantSalesRole(tdb(context.supabase), context.userId, context.tenantId);
    const { error } = await tdb(context.supabase).from("quotes").update({ status: data.status }).eq("id", data.id).eq("tenant_id", membership.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
