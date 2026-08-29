/**
 * vendedor.functions.ts — Server functions para o portal do vendedor.
 *
 * SEC-04: Migrado de queries client-side diretas para server functions
 * com autenticação e isolamento de tenant adequados.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { escapeLike, sanitizeOrQuery } from "@/lib/sanitize";

// ─── Guard: exige que o usuário seja vendedor ou superior ───────────────────

async function requireSalesRep(sb: any, userId: string, tenantId: string) {
  // Verifica se tem perfil de vendedor neste tenant
  const { data: rep, error } = await sb
    .from("sales_reps")
    .select("id, user_id, max_discount_pct, can_sell_b2b")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!rep) throw new Error("Usuário não é vendedor ativo neste tenant");
  return rep as { id: string; user_id: string; max_discount_pct: number; can_sell_b2b: boolean };
}

// ─── Busca de produtos para pedido assistido ───────────────────────────────

export const searchProductsForAssist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    q: z.string().trim().min(2).max(100),
    limit: z.number().int().min(1).max(25).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    // SEC-04: autenticado, com tenant isolado via middleware
    const safe = sanitizeOrQuery(escapeLike(data.q));
    const { data: products, error } = await tdb(context.supabase)
      .from("products")
      .select("id, sku, name, price_b2c, price_b2b, sale_price_b2c, stock")
      .eq("active", true)
      .is("deleted_at", null)
      .eq("tenant_id", context.tenantId)
      .or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`)
      .order("sales_count", { ascending: false })
      .limit(data.limit ?? 10);
    if (error) throw new Error(error.message);
    return products ?? [];
  });

// ─── Criação de pedido assistido ───────────────────────────────────────────

export type AssistOrderInput = {
  lead_name:  string;
  lead_email: string;
  lead_phone: string;
  lead_cnpj:  string;
  notes:      string;
  items: Array<{ product_id: string; sku: string; name: string; price: number; qty: number }>;
  discount_pct: number;
  status: "rascunho" | "enviado";
};

const assistOrderSchema = z.object({
  lead_name: z.string().trim().min(2).max(120),
  lead_email: z.string().trim().max(255).email().or(z.literal("")),
  lead_phone: z.string().trim().min(8).max(30),
  lead_cnpj: z.string().trim().max(20),
  notes: z.string().trim().max(2000),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    qty: z.number().int().min(1).max(1000),
  }).passthrough()).min(1).max(100),
  discount_pct: z.number().min(0).max(100).default(0),
  status: z.enum(["rascunho", "enviado"]),
});

export const createAssistOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => assistOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const rep = await requireSalesRep(sb, context.userId, context.tenantId);
    if (!rep.can_sell_b2b) throw new Error("Este vendedor não está habilitado para vendas B2B");
    if (data.discount_pct > Number(rep.max_discount_pct ?? 0)) {
      throw new Error(`Desconto adicional acima do limite do vendedor (${Number(rep.max_discount_pct ?? 0).toFixed(2)}%)`);
    }

    const cnpjDigits = data.lead_cnpj.replace(/\D/g, "");
    const [{ data: priceSettings, error: priceSettingsError }, { data: priceAssignment, error: priceAssignmentError }] =
      await Promise.all([
        sb
          .from("b2b_price_table_settings")
          .select("table_a_discount_pct, table_b_discount_pct, table_c_discount_pct, active")
          .eq("tenant_id", context.tenantId)
          .maybeSingle(),
        cnpjDigits.length === 14
          ? sb
              .from("b2b_customer_price_tables")
              .select("price_table")
              .eq("tenant_id", context.tenantId)
              .eq("cnpj_digits", cnpjDigits)
              .eq("active", true)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
    if (priceSettingsError) throw new Error(priceSettingsError.message);
    if (priceAssignmentError) throw new Error(priceAssignmentError.message);

    const priceTable = priceAssignment?.price_table === "A" || priceAssignment?.price_table === "B" || priceAssignment?.price_table === "C"
      ? priceAssignment.price_table
      : "C";
    const tableDiscountPct = priceTable === "A"
      ? Number(priceSettings?.table_a_discount_pct ?? 8)
      : priceTable === "B"
        ? Number(priceSettings?.table_b_discount_pct ?? 5)
        : Number(priceSettings?.table_c_discount_pct ?? 0);

    let customerId: string | null = null;
    if (cnpjDigits.length === 14) {
      const { data: customer, error: customerError } = await sb
        .from("customers")
        .select("id")
        .eq("tenant_id", context.tenantId)
        .eq("document", cnpjDigits)
        .maybeSingle();
      if (customerError) throw new Error(customerError.message);
      customerId = customer?.id ?? null;
    }

    const productIds = [...new Set(data.items.map((item) => item.product_id))];
    if (productIds.length !== data.items.length) {
      throw new Error("Não repita produtos no pedido assistido");
    }

    // Preço, SKU e nome são sempre a fotografia atual do banco. O navegador
    // só envia os IDs e quantidades; isso impede adulteração do total.
    const { data: products, error: productsError } = await sb
      .from("products")
      .select("id, sku, name, stock, price_b2c, price_b2b, sale_price_b2c, active")
      .eq("tenant_id", context.tenantId)
      .eq("active", true)
      .is("deleted_at", null)
      .in("id", productIds);
    if (productsError) throw new Error(productsError.message);
    if ((products ?? []).length !== productIds.length) {
      throw new Error("Um ou mais produtos não estão disponíveis");
    }

    const productById = new Map((products ?? []).map((product: any) => [product.id, product]));
    const { data: stockRows, error: stockError } = await sb
      .from("product_stock")
      .select("product_id, on_hand, reserved")
      .eq("tenant_id", context.tenantId)
      .in("product_id", productIds);
    if (stockError) throw new Error(stockError.message);

    const stockByProduct = new Map<string, number>();
    for (const row of stockRows ?? []) {
      stockByProduct.set(
        row.product_id,
        (stockByProduct.get(row.product_id) ?? 0) + Math.max(Number(row.on_hand ?? 0) - Number(row.reserved ?? 0), 0),
      );
    }

    const authoritativeItems = data.items.map((item) => {
      const product = productById.get(item.product_id) as any;
      const available = stockByProduct.has(item.product_id)
        ? stockByProduct.get(item.product_id) ?? 0
        : Number(product.stock ?? 0);
      if (data.status === "enviado" && item.qty > available) {
        throw new Error(`Estoque insuficiente para "${product.name}" (disponível: ${available})`);
      }
      const basePrice = Number(product.price_b2b ?? product.sale_price_b2c ?? product.price_b2c ?? 0);
      if (!Number.isFinite(basePrice) || basePrice < 0) {
        throw new Error(`Preço inválido para "${product.name}"`);
      }
      const tablePrice = Number((basePrice * (1 - tableDiscountPct / 100)).toFixed(2));
      const price = Number((tablePrice * (1 - data.discount_pct / 100)).toFixed(2));
      return {
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        base_price: basePrice,
        price_table: priceTable,
        table_discount_pct: tableDiscountPct,
        extra_discount_pct: data.discount_pct,
        price,
        qty: item.qty,
      };
    });

    const subtotal = authoritativeItems.reduce(
      (sum, item) => sum + Number(item.base_price) * item.qty * (1 - tableDiscountPct / 100),
      0,
    );
    const total = authoritativeItems.reduce((sum, item) => sum + item.price * item.qty, 0);

    const { error } = await sb.from("sales_orders").insert({
      rep_id:     rep.id,
      customer_id: customerId,
      tenant_id:  context.tenantId,
      lead_name:  data.lead_name,
      lead_email: data.lead_email,
      lead_phone: data.lead_phone,
      lead_cnpj:  cnpjDigits || data.lead_cnpj,
      notes:      data.notes,
      items:      authoritativeItems,
      subtotal:    Number(subtotal.toFixed(2)),
      discount:   Number((subtotal - total).toFixed(2)),
      total:       Number(total.toFixed(2)),
      status:     data.status,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Listagem de pedidos do vendedor ────────────────────────────────────────

export const listMyOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const rep = await requireSalesRep(sb, context.userId, context.tenantId);

    const { data: orders, error } = await sb
      .from("sales_orders")
      .select("id, lead_name, lead_email, total, status, created_at")
      .eq("rep_id", rep.id)
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (error) throw new Error(error.message);
    return orders ?? [];
  });
