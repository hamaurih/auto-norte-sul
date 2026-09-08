/**
 * quotes.functions.ts — Módulo comercial de Orçamentos/Propostas.
 *
 * Regras:
 * - Toda autorização é tenant_memberships (owner/admin/manager/sales). Sem user_roles.
 * - O servidor é a autoridade: valida pertença do produto ao tenant, números
 *   finitos e não negativos, e recalcula subtotal/desconto/total.
 * - Nenhuma cobrança é criada aqui. Fechar venda gera apenas sales_orders.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { escapeLike, sanitizeOrQuery } from "@/lib/sanitize";
import { isQuoteCommerciallyLocked, QUOTE_LOCKED_MESSAGE } from "@/lib/quote-lock";

// ─── Autorização ───────────────────────────────────────────────────────────

const COMMERCIAL_ROLES = ["owner", "admin", "manager", "sales"] as const;
const MANAGER_ROLES = ["owner", "admin", "manager"] as const;

type Membership = { tenant_id: string; role: string };

async function requireCommercial(sb: any, userId: string, tenantId: string): Promise<Membership> {
  if (!tenantId) throw new Error("Ambiente não identificado.");
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: Membership) =>
    (COMMERCIAL_ROLES as readonly string[]).includes(item.role),
  );
  if (!membership) throw new Error("Usuário sem acesso comercial ativo neste ambiente.");
  return membership as Membership;
}

const isManager = (role: string) => (MANAGER_ROLES as readonly string[]).includes(role);

// ─── Tipos e schemas ───────────────────────────────────────────────────────

export const QUOTE_STATUSES = [
  "rascunho",
  "enviado",
  "em_negociacao",
  "aprovado",
  "recusado",
  "convertido",
  "expirado",
] as const;

export const QUOTE_ORIGINS = ["whatsapp", "ia", "site", "vendedor", "balcao", "b2b"] as const;

const money = z.number().finite().min(0).max(99999999);

const itemSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  sku: z.string().trim().max(80).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  qty: z.number().finite().gt(0).max(100000),
  unit_price: money,
  discount: money.default(0),
  notes: z.string().trim().max(500).nullable().optional(),
});

const quoteSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().max(160).nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  customer_name: z.string().trim().max(160).nullable().optional(),
  customer_email: z.string().trim().max(255).nullable().optional(),
  customer_phone: z.string().trim().max(40).nullable().optional(),
  sales_rep_id: z.string().uuid().nullable().optional(),
  branch_id: z.string().uuid().nullable().optional(),
  origin: z.enum(QUOTE_ORIGINS).default("vendedor"),
  discount: money.default(0),
  shipping_amount: money.default(0),
  payment_terms: z.string().trim().max(500).nullable().optional(),
  delivery_terms: z.string().trim().max(500).nullable().optional(),
  internal_notes: z.string().trim().max(4000).nullable().optional(),
  customer_notes: z.string().trim().max(4000).nullable().optional(),
  valid_until: z.string().trim().min(4).max(40).nullable().optional(),
  follow_up_at: z.string().trim().min(4).max(60).nullable().optional(),
  items: z.array(itemSchema).max(200).default([]),
});

export type QuoteItemInput = z.infer<typeof itemSchema>;
export type QuoteInput = z.input<typeof quoteSchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function computeTotals(items: QuoteItemInput[], discount: number, shipping: number) {
  const gross = items.reduce((sum, item) => sum + item.qty * item.unit_price, 0);
  const itemsDiscount = items.reduce((sum, item) => sum + (item.discount ?? 0), 0);
  const subtotal = round2(Math.max(gross - itemsDiscount, 0));
  const total = round2(Math.max(subtotal - discount, 0) + shipping);
  return { gross: round2(gross), itemsDiscount: round2(itemsDiscount), subtotal, total };
}

async function logEvent(
  sb: any,
  params: {
    tenantId: string;
    quoteId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    note?: string | null;
    actorUserId: string;
  },
) {
  const { error } = await sb.from("quote_events").insert({
    tenant_id: params.tenantId,
    quote_id: params.quoteId,
    event_type: params.eventType,
    from_status: params.fromStatus ?? null,
    to_status: params.toStatus ?? null,
    note: params.note ?? null,
    actor_user_id: params.actorUserId,
  });
  // O histórico nunca deve derrubar a operação comercial.
  if (error) console.warn("[quotes] falha ao registrar evento:", error.message);
}

async function loadQuoteOrThrow(sb: any, tenantId: string, id: string) {
  const { data, error } = await sb
    .from("quotes")
    .select("*, items:quote_items(*)")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Orçamento não encontrado neste ambiente.");
  return data as any;
}

/** Valida que os produtos referenciados pertencem ao tenant e devolve o mapa. */
async function assertProductsInTenant(sb: any, tenantId: string, items: QuoteItemInput[]) {
  const ids = [...new Set(items.map((item) => item.product_id).filter(Boolean))] as string[];
  if (ids.length === 0) return new Map<string, any>();
  const { data, error } = await sb
    .from("products")
    .select("id, sku, name")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  if ((data ?? []).length !== ids.length) {
    throw new Error("Um ou mais produtos não pertencem a este ambiente.");
  }
  return new Map<string, any>((data ?? []).map((row: any) => [row.id as string, row]));
}

/** Saldo disponível por produto (product_stock é a fonte canônica). */
async function availableStock(sb: any, tenantId: string, productIds: string[]) {
  const available = new Map<string, number>();
  if (productIds.length === 0) return available;
  const { data, error } = await sb
    .from("product_stock")
    .select("product_id, on_hand, reserved")
    .eq("tenant_id", tenantId)
    .in("product_id", productIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const free = Math.max(Number(row.on_hand ?? 0) - Number(row.reserved ?? 0), 0);
    available.set(row.product_id, (available.get(row.product_id) ?? 0) + free);
  }
  return available;
}

/** Para role sales, respeita o teto de desconto do vendedor. */
async function assertDiscountAllowed(
  sb: any,
  membership: Membership,
  userId: string,
  quote: { subtotal: number; discount: number; items: any[] },
) {
  if (isManager(membership.role)) return;
  const gross = (quote.items ?? []).reduce(
    (sum: number, item: any) => sum + Number(item.qty ?? 0) * Number(item.unit_price ?? 0),
    0,
  );
  if (gross <= 0) return;
  const totalDiscount =
    (quote.items ?? []).reduce((sum: number, item: any) => sum + Number(item.discount ?? 0), 0) +
    Number(quote.discount ?? 0);
  const pct = (totalDiscount / gross) * 100;
  if (!Number.isFinite(pct) || pct < 0) throw new Error("Desconto inválido.");
  const { data: rep } = await sb
    .from("sales_reps")
    .select("max_discount_pct")
    .eq("tenant_id", membership.tenant_id)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  const max = Number(rep?.max_discount_pct ?? 0);
  if (max > 0 && pct > max + 0.001) {
    throw new Error(`Desconto de ${pct.toFixed(2)}% acima do seu limite (${max.toFixed(2)}%).`);
  }
}

// ─── Listagem e painel ─────────────────────────────────────────────────────

const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(QUOTE_STATUSES).optional(),
  origin: z.enum(QUOTE_ORIGINS).optional(),
  sales_rep_id: z.string().uuid().optional(),
  bucket: z
    .enum(["todos", "rascunhos", "enviados", "negociacao", "aprovados", "fechados", "perdidos"])
    .default("todos"),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

const BUCKET_STATUS: Record<string, readonly string[]> = {
  rascunhos: ["rascunho"],
  enviados: ["enviado"],
  negociacao: ["em_negociacao"],
  aprovados: ["aprovado"],
  fechados: ["convertido"],
  perdidos: ["recusado", "expirado"],
};

export const listQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);

    let query = sb
      .from("quotes")
      .select("*")
      .eq("tenant_id", membership.tenant_id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(data.limit);

    if (data.status) query = query.eq("status", data.status);
    else if (data.bucket !== "todos" && BUCKET_STATUS[data.bucket]) {
      query = query.in("status", BUCKET_STATUS[data.bucket] as string[]);
    }
    if (data.origin) query = query.eq("origin", data.origin);
    if (data.sales_rep_id) query = query.eq("sales_rep_id", data.sales_rep_id);
    if (data.from) query = query.gte("created_at", data.from);
    if (data.to) query = query.lte("created_at", data.to);
    if (data.search) {
      const safe = sanitizeOrQuery(escapeLike(data.search));
      const numeric = /^\d+$/.test(data.search.trim()) ? `,number.eq.${data.search.trim()}` : "";
      query = query.or(
        `customer_name.ilike.%${safe}%,customer_email.ilike.%${safe}%,customer_phone.ilike.%${safe}%${numeric}`,
      );
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const repIds = [...new Set((rows ?? []).map((row: any) => row.sales_rep_id).filter(Boolean))] as string[];
    let repNames = new Map<string, string>();
    if (repIds.length > 0) {
      const { data: reps } = await sb
        .from("sales_reps")
        .select("id, full_name")
        .eq("tenant_id", membership.tenant_id)
        .in("id", repIds);
      repNames = new Map((reps ?? []).map((rep: any) => [rep.id, rep.full_name]));
    }

    return (rows ?? []).map((row: any) => ({
      ...row,
      sales_rep_name: row.sales_rep_id ? repNames.get(row.sales_rep_id) ?? null : null,
    }));
  });

export const getQuoteDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const { data: rows, error } = await sb
      .from("quotes")
      .select("id, status, total, valid_until, follow_up_at")
      .eq("tenant_id", membership.tenant_id)
      .is("deleted_at", null)
      .limit(5000);
    if (error) throw new Error(error.message);

    const all = rows ?? [];
    const count = (statuses: string[]) => all.filter((row: any) => statuses.includes(row.status)).length;
    const openStatuses = ["rascunho", "enviado", "em_negociacao"];
    const pipeline = all
      .filter((row: any) => openStatuses.includes(row.status) || row.status === "aprovado")
      .reduce((sum: number, row: any) => sum + Number(row.total ?? 0), 0);
    const closed = count(["convertido"]);
    const finished = closed + count(["recusado", "expirado"]);
    const now = Date.now();
    const in7 = now + 7 * 24 * 60 * 60 * 1000;
    const expiring = all.filter((row: any) => {
      if (!row.valid_until || !openStatuses.includes(row.status)) return false;
      const time = new Date(row.valid_until).getTime();
      return Number.isFinite(time) && time >= now && time <= in7;
    }).length;
    const lateFollowUps = all.filter((row: any) => {
      if (!row.follow_up_at || !openStatuses.includes(row.status)) return false;
      const time = new Date(row.follow_up_at).getTime();
      return Number.isFinite(time) && time < now;
    }).length;

    return {
      open: count(["rascunho", "enviado"]),
      negotiating: count(["em_negociacao"]),
      approved: count(["aprovado"]),
      pipeline: round2(pipeline),
      conversionRate: finished > 0 ? Math.round((closed / finished) * 100) : 0,
      expiringIn7: expiring,
      lateFollowUps,
      total: all.length,
    };
  });

// ─── Detalhe ───────────────────────────────────────────────────────────────

export const getQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const quote = await loadQuoteOrThrow(sb, membership.tenant_id, data.id);

    const { data: events } = await sb
      .from("quote_events")
      .select("id, event_type, from_status, to_status, note, created_at")
      .eq("tenant_id", membership.tenant_id)
      .eq("quote_id", data.id)
      .order("created_at", { ascending: false })
      .limit(200);

    let salesRep: any = null;
    if (quote.sales_rep_id) {
      const { data: rep } = await sb
        .from("sales_reps")
        .select("id, full_name, email, phone")
        .eq("tenant_id", membership.tenant_id)
        .eq("id", quote.sales_rep_id)
        .maybeSingle();
      salesRep = rep ?? null;
    }

    let branch: any = null;
    if (quote.branch_id) {
      const { data: row } = await sb
        .from("branches")
        .select("id, name, code, city, state, phone")
        .eq("tenant_id", membership.tenant_id)
        .eq("id", quote.branch_id)
        .maybeSingle();
      branch = row ?? null;
    }

    let salesOrder: any = null;
    const { data: order } = await sb
      .from("sales_orders")
      .select("id, status, total, created_at")
      .eq("tenant_id", membership.tenant_id)
      .eq("quote_id", data.id)
      .maybeSingle();
    salesOrder = order ?? null;

    return {
      quote,
      events: events ?? [],
      salesRep,
      branch,
      salesOrder,
      role: membership.role,
    };
  });

export const getQuoteContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);

    const [{ data: reps }, { data: branches }] = await Promise.all([
      sb
        .from("sales_reps")
        .select("id, full_name, email, user_id, max_discount_pct")
        .eq("tenant_id", membership.tenant_id)
        .eq("active", true)
        .order("full_name"),
      sb
        .from("branches")
        .select("id, name, code, is_main")
        .eq("tenant_id", membership.tenant_id)
        .eq("active", true)
        .order("name"),
    ]);

    const currentRep = (reps ?? []).find((rep: any) => rep.user_id === context.userId) ?? null;
    return {
      role: membership.role,
      canChooseRep: isManager(membership.role),
      reps: reps ?? [],
      branches: branches ?? [],
      currentRep,
    };
  });

export const searchQuoteCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ q: z.string().trim().min(2).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const safe = sanitizeOrQuery(escapeLike(data.q));
    const { data: rows, error } = await sb
      .from("customers")
      .select("id, name, document, email, phone, customer_group")
      .eq("tenant_id", membership.tenant_id)
      .eq("active", true)
      .or(`name.ilike.%${safe}%,document.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
      .order("name")
      .limit(12);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const searchQuoteProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ q: z.string().trim().min(2).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const safe = sanitizeOrQuery(escapeLike(data.q));
    const { data: rows, error } = await sb
      .from("products")
      .select("id, sku, name, internal_code, manufacturer_code, price_b2c, price_b2b, sale_price_b2c")
      .eq("tenant_id", membership.tenant_id)
      .eq("active", true)
      .is("deleted_at", null)
      .or(
        `name.ilike.%${safe}%,sku.ilike.%${safe}%,internal_code.ilike.%${safe}%,manufacturer_code.ilike.%${safe}%`,
      )
      .limit(15);
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((row: any) => row.id);
    const stock = await availableStock(sb, membership.tenant_id, ids);
    return (rows ?? []).map((row: any) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      internal_code: row.internal_code ?? null,
      manufacturer_code: row.manufacturer_code ?? null,
      price: Number(row.sale_price_b2c ?? row.price_b2c ?? row.price_b2b ?? 0),
      available: stock.get(row.id) ?? 0,
    }));
  });

// ─── Criação / edição ──────────────────────────────────────────────────────

export const upsertQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const tenantId = membership.tenant_id;

    // Documento enviado/encerrado é snapshot imutável: nada é atualizado nem apagado aqui.
    let existing: any = null;
    if (data.id) {
      existing = await loadQuoteOrThrow(sb, tenantId, data.id);
      if (isQuoteCommerciallyLocked(existing)) throw new Error(QUOTE_LOCKED_MESSAGE);
    }


    const items = data.items ?? [];
    await assertProductsInTenant(sb, tenantId, items);

    let salesRepId = data.sales_rep_id ?? null;
    if (salesRepId) {
      const { data: rep } = await sb
        .from("sales_reps")
        .select("id, user_id")
        .eq("tenant_id", tenantId)
        .eq("id", salesRepId)
        .maybeSingle();
      if (!rep) throw new Error("Vendedor não encontrado neste ambiente.");
      if (!isManager(membership.role) && rep.user_id !== context.userId) {
        throw new Error("Somente gestores podem atribuir o orçamento a outro vendedor.");
      }
    } else if (!isManager(membership.role)) {
      const { data: rep } = await sb
        .from("sales_reps")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", context.userId)
        .eq("active", true)
        .maybeSingle();
      salesRepId = rep?.id ?? null;
    }

    if (data.branch_id) {
      const { data: branch } = await sb
        .from("branches")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", data.branch_id)
        .maybeSingle();
      if (!branch) throw new Error("Filial não encontrada neste ambiente.");
    }
    if (data.customer_id) {
      const { data: customer } = await sb
        .from("customers")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", data.customer_id)
        .maybeSingle();
      if (!customer) throw new Error("Cliente não encontrado neste ambiente.");
    }

    const totals = computeTotals(items, data.discount ?? 0, data.shipping_amount ?? 0);

    const row: Record<string, unknown> = {
      tenant_id: tenantId,
      title: data.title || null,
      customer_id: data.customer_id ?? null,
      customer_name: data.customer_name || null,
      customer_email: data.customer_email || null,
      customer_phone: data.customer_phone || null,
      sales_rep_id: salesRepId,
      branch_id: data.branch_id ?? null,
      origin: data.origin ?? "vendedor",
      subtotal: totals.subtotal,
      discount: round2(data.discount ?? 0),
      shipping_amount: round2(data.shipping_amount ?? 0),
      total: totals.total,
      payment_terms: data.payment_terms || null,
      delivery_terms: data.delivery_terms || null,
      internal_notes: data.internal_notes || null,
      customer_notes: data.customer_notes || null,
      valid_until: data.valid_until || null,
      follow_up_at: data.follow_up_at || null,
    };

    let quoteId = data.id;
    let created = false;

    if (quoteId) {
      if (!existing || isQuoteCommerciallyLocked(existing)) throw new Error(QUOTE_LOCKED_MESSAGE);
      const { error } = await sb.from("quotes").update(row).eq("id", quoteId).eq("tenant_id", tenantId);

      if (error) throw new Error(error.message);
      await sb.from("quote_items").delete().eq("tenant_id", tenantId).eq("quote_id", quoteId);
    } else {
      created = true;
      row["status"] = "rascunho";
      row["document_type"] = "orcamento";
      row["version"] = 1;
      row["created_by"] = context.userId;
      const { data: inserted, error } = await sb.from("quotes").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      quoteId = inserted.id as string;
    }

    if (items.length > 0) {
      const { error } = await sb.from("quote_items").insert(
        items.map((item) => ({
          tenant_id: tenantId,
          quote_id: quoteId!,
          product_id: item.product_id ?? null,
          sku: item.sku || null,
          name: item.name,
          qty: item.qty,
          unit_price: round2(item.unit_price),
          discount: round2(item.discount ?? 0),
          total: round2(item.qty * item.unit_price - (item.discount ?? 0)),
          notes: item.notes || null,
        })),
      );
      if (error) throw new Error(error.message);
    }

    await logEvent(sb, {
      tenantId,
      quoteId: quoteId!,
      eventType: created ? "criado" : "editado",
      actorUserId: context.userId,
    });

    return { ok: true, id: quoteId!, totals };
  });

// ─── Transições de etapa ───────────────────────────────────────────────────

export const transitionQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["enviado", "em_negociacao", "aprovado", "recusado", "expirado", "rascunho"]),
        note: z.string().trim().max(1000).optional(),
        lost_reason: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const quote = await loadQuoteOrThrow(sb, membership.tenant_id, data.id);
    if (quote.status === "convertido") throw new Error("Orçamento já convertido em pedido.");

    if (data.status === "recusado" && !(data.lost_reason || "").trim()) {
      throw new Error("Informe o motivo da perda.");
    }

    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "aprovado") patch["approved_at"] = new Date().toISOString();
    if (data.status === "recusado") {
      patch["lost_reason"] = data.lost_reason!.trim();
      patch["closed_at"] = new Date().toISOString();
    }
    if (data.status === "enviado") patch["sent_at"] = new Date().toISOString();

    const { error } = await sb
      .from("quotes")
      .update(patch)
      .eq("id", data.id)
      .eq("tenant_id", membership.tenant_id);
    if (error) throw new Error(error.message);

    await logEvent(sb, {
      tenantId: membership.tenant_id,
      quoteId: data.id,
      eventType: "status",
      fromStatus: quote.status,
      toStatus: data.status,
      note: data.lost_reason?.trim() || data.note || null,
      actorUserId: context.userId,
    });
    return { ok: true };
  });

export const generateProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const quote = await loadQuoteOrThrow(sb, membership.tenant_id, data.id);
    if (quote.status === "convertido") throw new Error("Orçamento já convertido em pedido.");

    const items = quote.items ?? [];
    if (!(quote.customer_name || "").trim() && !quote.customer_id) {
      throw new Error("Informe o cliente antes de gerar a proposta.");
    }
    if (items.length === 0) throw new Error("Adicione ao menos um item antes de gerar a proposta.");
    if (Number(quote.total ?? 0) < 0) throw new Error("Total inválido.");
    if (!quote.valid_until) throw new Error("Defina a validade da proposta.");

    await assertDiscountAllowed(sb, membership, context.userId, quote);

    const { error } = await sb
      .from("quotes")
      .update({
        document_type: "proposta",
        status: "enviado",
        sent_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("tenant_id", membership.tenant_id);
    if (error) throw new Error(error.message);

    await logEvent(sb, {
      tenantId: membership.tenant_id,
      quoteId: data.id,
      eventType: "proposta_gerada",
      fromStatus: quote.status,
      toStatus: "enviado",
      actorUserId: context.userId,
    });
    return { ok: true };
  });

// ─── Revisões ──────────────────────────────────────────────────────────────

/**
 * Descobre a maior versão existente na cadeia de revisões (tenant-scoped) e devolve a próxima.
 * Sobe por parent_quote_id até a raiz e percorre os descendentes em largura, com limites de segurança.
 */
async function nextChainVersion(sb: any, tenantId: string, source: any): Promise<number> {
  const MAX_HOPS = 50;
  const MAX_NODES = 500;

  // 1) Sobe até a raiz da cadeia.
  let rootId = source.id as string;
  let parentId = (source.parent_quote_id as string | null) ?? null;
  for (let hop = 0; hop < MAX_HOPS && parentId; hop += 1) {
    const { data: parent } = await sb
      .from("quotes")
      .select("id, parent_quote_id")
      .eq("tenant_id", tenantId)
      .eq("id", parentId)
      .maybeSingle();
    if (!parent) break;
    rootId = parent.id as string;
    parentId = (parent.parent_quote_id as string | null) ?? null;
  }

  // 2) Percorre os descendentes da raiz.
  const { data: root } = await sb
    .from("quotes")
    .select("id, version")
    .eq("tenant_id", tenantId)
    .eq("id", rootId)
    .maybeSingle();

  let maxVersion = Math.max(Number(source.version ?? 1), Number(root?.version ?? 1));
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];

  for (let depth = 0; depth < MAX_HOPS && frontier.length > 0 && seen.size < MAX_NODES; depth += 1) {
    const { data: children } = await sb
      .from("quotes")
      .select("id, version")
      .eq("tenant_id", tenantId)
      .in("parent_quote_id", frontier);
    const next: string[] = [];
    for (const child of children ?? []) {
      const childId = child.id as string;
      if (seen.has(childId)) continue;
      seen.add(childId);
      maxVersion = Math.max(maxVersion, Number(child.version ?? 1));
      next.push(childId);
      if (seen.size >= MAX_NODES) break;
    }
    frontier = next;
  }

  return maxVersion + 1;
}

export const createQuoteRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const tenantId = membership.tenant_id;
    const source = await loadQuoteOrThrow(sb, tenantId, data.id);

    const nextVersion = await nextChainVersion(sb, tenantId, source);

    const row = {
      tenant_id: tenantId,
      title: source.title ?? null,
      customer_id: source.customer_id ?? null,
      customer_name: source.customer_name ?? null,
      customer_email: source.customer_email ?? null,
      customer_phone: source.customer_phone ?? null,
      sales_rep_id: source.sales_rep_id ?? null,
      branch_id: source.branch_id ?? null,
      origin: source.origin,
      status: "rascunho",
      document_type: "orcamento",
      version: nextVersion,
      parent_quote_id: source.id,
      subtotal: source.subtotal ?? 0,
      discount: source.discount ?? 0,
      shipping_amount: source.shipping_amount ?? 0,
      total: source.total ?? 0,
      payment_terms: source.payment_terms ?? null,
      delivery_terms: source.delivery_terms ?? null,
      internal_notes: source.internal_notes ?? null,
      customer_notes: source.customer_notes ?? null,
      valid_until: source.valid_until ?? null,
      follow_up_at: null,
      sent_at: null,
      approved_at: null,
      closed_at: null,
      lost_reason: null,
      converted_sales_order_id: null,
      created_by: context.userId,
    };

    const { data: inserted, error } = await sb.from("quotes").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    const newId = inserted.id as string;

    const items = source.items ?? [];
    if (items.length > 0) {
      const { error: itemsError } = await sb.from("quote_items").insert(
        items.map((item: any) => ({
          tenant_id: tenantId,
          quote_id: newId,
          product_id: item.product_id ?? null,
          sku: item.sku ?? null,
          name: item.name,
          qty: item.qty,
          unit_price: item.unit_price,
          discount: item.discount ?? 0,
          total: item.total ?? 0,
          notes: item.notes ?? null,
        })),
      );
      if (itemsError) throw new Error(itemsError.message);
    }

    await logEvent(sb, {
      tenantId,
      quoteId: source.id,
      eventType: "revisao_criada",
      note: `Revisão v${row.version} gerada.`,
      actorUserId: context.userId,
    });
    await logEvent(sb, {
      tenantId,
      quoteId: newId,
      eventType: "criado",
      note: `Revisão do orçamento #${source.number}.`,
      actorUserId: context.userId,
    });

    return { ok: true, id: newId };
  });

/** Duplicação simples (novo documento, sem vínculo de versão). */
export const duplicateQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const tenantId = membership.tenant_id;
    const source = await loadQuoteOrThrow(sb, tenantId, data.id);

    const { data: inserted, error } = await sb
      .from("quotes")
      .insert({
        tenant_id: tenantId,
        title: source.title ?? null,
        customer_id: source.customer_id ?? null,
        customer_name: source.customer_name ?? null,
        customer_email: source.customer_email ?? null,
        customer_phone: source.customer_phone ?? null,
        sales_rep_id: source.sales_rep_id ?? null,
        branch_id: source.branch_id ?? null,
        origin: source.origin,
        status: "rascunho",
        document_type: "orcamento",
        version: 1,
        subtotal: source.subtotal ?? 0,
        discount: source.discount ?? 0,
        shipping_amount: source.shipping_amount ?? 0,
        total: source.total ?? 0,
        payment_terms: source.payment_terms ?? null,
        delivery_terms: source.delivery_terms ?? null,
        internal_notes: source.internal_notes ?? null,
        customer_notes: source.customer_notes ?? null,
        valid_until: source.valid_until ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const newId = inserted.id as string;

    const items = source.items ?? [];
    if (items.length > 0) {
      const { error: itemsError } = await sb.from("quote_items").insert(
        items.map((item: any) => ({
          tenant_id: tenantId,
          quote_id: newId,
          product_id: item.product_id ?? null,
          sku: item.sku ?? null,
          name: item.name,
          qty: item.qty,
          unit_price: item.unit_price,
          discount: item.discount ?? 0,
          total: item.total ?? 0,
          notes: item.notes ?? null,
        })),
      );
      if (itemsError) throw new Error(itemsError.message);
    }

    await logEvent(sb, {
      tenantId,
      quoteId: newId,
      eventType: "criado",
      note: `Cópia do orçamento #${source.number}.`,
      actorUserId: context.userId,
    });
    return { ok: true, id: newId };
  });

// ─── Fechamento / conversão em pedido comercial ────────────────────────────

export const convertQuoteToSalesOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        sales_rep_id: z.string().uuid().optional(),
        note: z.string().trim().max(1000).optional(),
        approve_if_negotiating: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const membership = await requireCommercial(sb, context.userId, context.tenantId);
    const tenantId = membership.tenant_id;
    const quote = await loadQuoteOrThrow(sb, tenantId, data.id);

    // Idempotência: já convertido devolve o mesmo pedido.
    const { data: existing } = await sb
      .from("sales_orders")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("quote_id", data.id)
      .maybeSingle();
    if (existing?.id) return { ok: true, id: existing.id as string, alreadyConverted: true };

    if (quote.status === "aprovado") {
      // segue
    } else if (quote.status === "em_negociacao" || quote.status === "enviado") {
      if (!data.approve_if_negotiating) {
        throw new Error("Aprove a proposta ou confirme a aprovação junto com o fechamento.");
      }
    } else {
      throw new Error("Somente propostas aprovadas ou em negociação podem ser fechadas.");
    }

    const items = quote.items ?? [];
    if (items.length === 0) throw new Error("Orçamento sem itens.");

    // Vendedor obrigatório.
    let repId = data.sales_rep_id ?? quote.sales_rep_id ?? null;
    if (!repId) {
      const { data: myRep } = await sb
        .from("sales_reps")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", context.userId)
        .eq("active", true)
        .maybeSingle();
      repId = myRep?.id ?? null;
    }
    if (!repId) throw new Error("Selecione o vendedor responsável pelo fechamento.");
    const { data: rep } = await sb
      .from("sales_reps")
      .select("id, user_id, active")
      .eq("tenant_id", tenantId)
      .eq("id", repId)
      .maybeSingle();
    if (!rep || rep.active === false) throw new Error("Vendedor inválido ou inativo.");
    if (!isManager(membership.role) && rep.user_id !== context.userId) {
      throw new Error("Somente gestores podem fechar em nome de outro vendedor.");
    }

    // Produtos e estoque revalidados no servidor.
    const productMap = await assertProductsInTenant(sb, tenantId, items as QuoteItemInput[]);
    const productIds = [...productMap.keys()] as string[];
    const stock = await availableStock(sb, tenantId, productIds);
    const shortages: string[] = [];
    const neededByProduct = new Map<string, number>();
    for (const item of items as any[]) {
      if (!item.product_id) continue;
      neededByProduct.set(item.product_id, (neededByProduct.get(item.product_id) ?? 0) + Number(item.qty ?? 0));
    }
    for (const [productId, needed] of neededByProduct) {
      const available = stock.get(productId) ?? 0;
      if (needed > available) {
        const product = productMap.get(productId);
        shortages.push(`${product?.name ?? productId}: pedido ${needed}, disponível ${available}`);
      }
    }
    if (shortages.length > 0) {
      throw new Error(`Estoque insuficiente para fechar: ${shortages.join(" · ")}`);
    }

    const totals = computeTotals(
      (items as any[]).map((item) => ({
        ...item,
        qty: Number(item.qty ?? 0),
        unit_price: Number(item.unit_price ?? 0),
        discount: Number(item.discount ?? 0),
      })) as QuoteItemInput[],
      Number(quote.discount ?? 0),
      Number(quote.shipping_amount ?? 0),
    );

    const snapshot = (items as any[]).map((item) => ({
      product_id: item.product_id ?? null,
      sku: item.sku ?? null,
      name: item.name,
      qty: Number(item.qty ?? 0),
      price: Number(item.unit_price ?? 0),
      discount: Number(item.discount ?? 0),
      total: round2(Number(item.qty ?? 0) * Number(item.unit_price ?? 0) - Number(item.discount ?? 0)),
    }));

    const { data: order, error } = await sb
      .from("sales_orders")
      .insert({
        tenant_id: tenantId,
        rep_id: repId,
        customer_id: quote.customer_id ?? null,
        lead_name: quote.customer_name ?? null,
        lead_email: quote.customer_email ?? null,
        lead_phone: quote.customer_phone ?? null,
        items: snapshot,
        subtotal: totals.subtotal,
        discount: round2(Number(quote.discount ?? 0) + totals.itemsDiscount),
        total: round2(Number(quote.total ?? totals.total)),
        status: "enviado",
        notes: [quote.customer_notes, data.note].filter(Boolean).join("\n") || null,
        idempotency_key: crypto.randomUUID(),
        quote_id: data.id,
        price_uplift_pct: 0,
        seller_credit_used: 0,
        seller_credit_earned: 0,
      })
      .select("id")
      .single();
    if (error) {
      // Corrida: outro fechamento simultâneo já criou o pedido.
      const { data: raced } = await sb
        .from("sales_orders")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("quote_id", data.id)
        .maybeSingle();
      if (raced?.id) return { ok: true, id: raced.id as string, alreadyConverted: true };
      throw new Error(error.message);
    }

    const now = new Date().toISOString();
    const { error: quoteError } = await sb
      .from("quotes")
      .update({
        status: "convertido",
        closed_at: now,
        approved_at: quote.approved_at ?? now,
        converted_sales_order_id: order.id,
        sales_rep_id: repId,
      })
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (quoteError) throw new Error(quoteError.message);

    await logEvent(sb, {
      tenantId,
      quoteId: data.id,
      eventType: "convertido",
      fromStatus: quote.status,
      toStatus: "convertido",
      note: data.note || "Pedido comercial gerado.",
      actorUserId: context.userId,
    });

    return { ok: true, id: order.id as string, alreadyConverted: false };
  });

// Compatibilidade com chamadas anteriores.
export const setQuoteStatus = transitionQuote;
