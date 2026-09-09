import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

const PRICING_ROLES = ["owner", "admin", "manager"];

async function requireProfitabilityRole(supabase: any, userId: string, tenantId: string) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !PRICING_ROLES.includes(data.role)) throw new Error("Sem permissão para custos e rentabilidade");
}

function pct(value: unknown, label: string) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${label} deve ficar entre 0% e 100%`);
  return n;
}

function money(value: unknown, label: string, allowNull = false) {
  if ((value === null || value === undefined || value === "") && allowNull) return null;
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} inválido`);
  return n;
}

export const getProfitabilityCenter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { month?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireProfitabilityRole(sb, context.userId, context.tenantId);
    const month = data.month ? `${data.month.slice(0, 7)}-01` : new Date().toISOString().slice(0, 7) + "-01";
    const [settings, dashboard, channels, categories, centers, expenses] = await Promise.all([
      sb.from("tenant_pricing_settings")
        .select("default_target_margin_pct,default_min_margin_pct,default_sales_channel_id,price_rounding")
        .eq("tenant_id", context.tenantId)
        .maybeSingle(),
      sb.rpc("get_profitability_dashboard", { p_tenant_id: context.tenantId, p_month: month }),
      sb.from("sales_channels")
        .select("id,code,name,active,is_default,tax_pct,payment_fee_pct,sales_commission_pct,marketplace_fee_pct,freight_subsidy_pct,anticipation_pct,expected_loss_pct,other_variable_pct,fixed_fee_per_sale")
        .eq("tenant_id", context.tenantId)
        .order("is_default", { ascending: false })
        .order("name"),
      sb.from("expense_categories")
        .select("id,name,default_kind,active")
        .eq("tenant_id", context.tenantId)
        .eq("active", true)
        .order("name"),
      sb.from("cost_centers")
        .select("id,name,active")
        .eq("tenant_id", context.tenantId)
        .eq("active", true)
        .order("name"),
      sb.from("expenses")
        .select("id,category_id,cost_center_id,description,kind,status,amount,competence_date,due_date,paid_at,supplier_name,document_number,notes,recurring,recurrence,created_at")
        .eq("tenant_id", context.tenantId)
        .order("competence_date", { ascending: false })
        .limit(100),
    ]);
    for (const result of [settings, dashboard, channels, categories, centers, expenses]) {
      if (result.error) throw new Error(result.error.message);
    }
    return {
      settings: settings.data ?? { default_target_margin_pct: 20, default_min_margin_pct: 10, default_sales_channel_id: null, price_rounding: "cent" },
      dashboard: dashboard.data ?? {},
      channels: channels.data ?? [],
      categories: categories.data ?? [],
      centers: centers.data ?? [],
      expenses: expenses.data ?? [],
    };
  });

export const searchProfitabilityProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { search?: string; limit?: number }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireProfitabilityRole(sb, context.userId, context.tenantId);
    const limit = Math.max(1, Math.min(Number(data.limit ?? 30), 60));
    const search = String(data.search ?? "").trim();
    let query = sb.from("products")
      .select("id,sku,internal_code,name,price_b2c,price_b2b,average_cost,last_purchase_cost,active")
      .eq("tenant_id", context.tenantId)
      .is("deleted_at", null)
      .order("name")
      .limit(limit);
    if (search) {
      const safe = search.replace(/[,()*%\\"']/g, " ").replace(/\s+/g, " ").trim();
      query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,internal_code.ilike.%${safe}%`);
    }
    const products = await query;
    if (products.error) throw new Error(products.error.message);
    const ids = (products.data ?? []).map((p: any) => p.id);
    const rules = ids.length
      ? await sb.from("product_profitability_rules")
          .select("product_id,cost_basis,replacement_cost,manual_cost,inbound_freight_value,packaging_cost,other_unit_cost,inventory_loss_pct,target_margin_pct,min_margin_pct,preferred_channel_id")
          .eq("tenant_id", context.tenantId)
          .in("product_id", ids)
      : ({ data: [], error: null } as any);
    if (rules.error) throw new Error(rules.error.message);
    const ruleMap = new Map((rules.data ?? []).map((r: any) => [r.product_id, r]));
    return (products.data ?? []).map((p: any) => ({ ...p, profitability_rule: ruleMap.get(p.id) ?? null }));
  });

export const saveProfitabilityDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetMarginPct: number; minMarginPct: number; defaultChannelId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireProfitabilityRole(sb, context.userId, context.tenantId);
    const target = Number(data.targetMarginPct);
    const minimum = Number(data.minMarginPct);
    if (!Number.isFinite(target) || target < 0 || target >= 95) throw new Error("Margem desejada deve ficar entre 0% e 94,99%");
    if (!Number.isFinite(minimum) || minimum < -100 || minimum >= 95) throw new Error("Margem mínima inválida");
    if (minimum > target) throw new Error("A margem mínima não pode ser maior que a margem desejada");
    if (data.defaultChannelId) {
      const channel = await sb.from("sales_channels").select("id").eq("tenant_id", context.tenantId).eq("id", data.defaultChannelId).eq("active", true).maybeSingle();
      if (channel.error) throw new Error(channel.error.message);
      if (!channel.data) throw new Error("Canal padrão inválido");
    }
    const result = await sb.from("tenant_pricing_settings")
      .update({
        default_target_margin_pct: target,
        default_min_margin_pct: minimum,
        default_sales_channel_id: data.defaultChannelId || null,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", context.tenantId)
      .select("tenant_id")
      .single();
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });

export const saveSalesChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string | null;
    name: string;
    code?: string | null;
    active?: boolean;
    isDefault?: boolean;
    taxPct?: number;
    paymentFeePct?: number;
    salesCommissionPct?: number;
    marketplaceFeePct?: number;
    freightSubsidyPct?: number;
    anticipationPct?: number;
    expectedLossPct?: number;
    otherVariablePct?: number;
    fixedFeePerSale?: number;
  }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireProfitabilityRole(sb, context.userId, context.tenantId);
    const name = String(data.name ?? "").trim();
    if (!name) throw new Error("Nome do canal é obrigatório");
    const code = String(data.code || name)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "canal";
    const payload = {
      tenant_id: context.tenantId,
      code,
      name,
      active: data.active !== false,
      is_default: Boolean(data.isDefault),
      tax_pct: pct(data.taxPct, "Impostos"),
      payment_fee_pct: pct(data.paymentFeePct, "Taxa de pagamento"),
      sales_commission_pct: pct(data.salesCommissionPct, "Comissão"),
      marketplace_fee_pct: pct(data.marketplaceFeePct, "Marketplace"),
      freight_subsidy_pct: pct(data.freightSubsidyPct, "Frete subsidiado"),
      anticipation_pct: pct(data.anticipationPct, "Antecipação"),
      expected_loss_pct: pct(data.expectedLossPct, "Perdas"),
      other_variable_pct: pct(data.otherVariablePct, "Outros custos variáveis"),
      fixed_fee_per_sale: money(data.fixedFeePerSale, "Taxa fixa"),
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    if (payload.is_default) {
      const clear = await sb.from("sales_channels").update({ is_default: false }).eq("tenant_id", context.tenantId).neq("id", data.id || "00000000-0000-0000-0000-000000000000");
      if (clear.error) throw new Error(clear.error.message);
    }
    const result = data.id
      ? await sb.from("sales_channels").update(payload).eq("tenant_id", context.tenantId).eq("id", data.id).select("id,is_default").single()
      : await sb.from("sales_channels").insert({ ...payload, created_by: context.userId }).select("id,is_default").single();
    if (result.error) throw new Error(result.error.message);
    if (result.data?.is_default) {
      const settings = await sb.from("tenant_pricing_settings")
        .update({ default_sales_channel_id: result.data.id, updated_by: context.userId, updated_at: new Date().toISOString() })
        .eq("tenant_id", context.tenantId);
      if (settings.error) throw new Error(settings.error.message);
    }
    return { ok: true, id: result.data.id };
  });

export const saveExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string | null;
    description: string;
    amount: number;
    kind: "fixed" | "variable";
    status?: "planned" | "paid" | "canceled";
    competenceDate: string;
    dueDate?: string | null;
    categoryId?: string | null;
    costCenterId?: string | null;
    supplierName?: string | null;
    documentNumber?: string | null;
    notes?: string | null;
    recurring?: boolean;
    recurrence?: "weekly" | "monthly" | "quarterly" | "yearly" | null;
  }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireProfitabilityRole(sb, context.userId, context.tenantId);
    const description = String(data.description ?? "").trim();
    if (!description) throw new Error("Descrição da despesa é obrigatória");
    const amount = money(data.amount, "Valor");
    const status = data.status ?? "planned";
    const payload: any = {
      tenant_id: context.tenantId,
      category_id: data.categoryId || null,
      cost_center_id: data.costCenterId || null,
      description,
      kind: data.kind,
      status,
      amount,
      competence_date: data.competenceDate,
      due_date: data.dueDate || null,
      paid_at: status === "paid" ? new Date().toISOString() : null,
      supplier_name: data.supplierName?.trim() || null,
      document_number: data.documentNumber?.trim() || null,
      notes: data.notes?.trim() || null,
      recurring: Boolean(data.recurring),
      recurrence: data.recurring ? data.recurrence || "monthly" : null,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    const result = data.id
      ? await sb.from("expenses").update(payload).eq("tenant_id", context.tenantId).eq("id", data.id).select("id").single()
      : await sb.from("expenses").insert({ ...payload, created_by: context.userId }).select("id").single();
    if (result.error) throw new Error(result.error.message);
    return { ok: true, id: result.data.id };
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireProfitabilityRole(sb, context.userId, context.tenantId);
    const result = await sb.from("expenses").delete().eq("tenant_id", context.tenantId).eq("id", data.id);
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });

export const simulateProfitability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string; channelId?: string | null; targetMarginPct?: number | null; salePrice?: number | null; quantity?: number }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireProfitabilityRole(sb, context.userId, context.tenantId);
    const result = await sb.rpc("simulate_product_profitability", {
      p_tenant_id: context.tenantId,
      p_product_id: data.productId,
      p_channel_id: data.channelId || null,
      p_target_margin_pct: data.targetMarginPct === null || data.targetMarginPct === undefined ? null : Number(data.targetMarginPct),
      p_sale_price: data.salePrice === null || data.salePrice === undefined ? null : Number(data.salePrice),
      p_quantity: Math.max(1, Number(data.quantity ?? 1)),
    });
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const saveProductProfitabilityRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    productId: string;
    costBasis?: "auto" | "average" | "last" | "replacement" | "manual";
    replacementCost?: number | null;
    manualCost?: number | null;
    inboundFreightValue?: number;
    packagingCost?: number;
    otherUnitCost?: number;
    inventoryLossPct?: number;
    targetMarginPct?: number | null;
    minMarginPct?: number | null;
    preferredChannelId?: string | null;
    applyRecommended?: boolean;
  }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireProfitabilityRole(sb, context.userId, context.tenantId);
    const target = data.targetMarginPct === null || data.targetMarginPct === undefined ? null : Number(data.targetMarginPct);
    const minimum = data.minMarginPct === null || data.minMarginPct === undefined ? null : Number(data.minMarginPct);
    if (target !== null && (!Number.isFinite(target) || target < 0 || target >= 95)) throw new Error("Margem desejada inválida");
    if (minimum !== null && (!Number.isFinite(minimum) || minimum < -100 || minimum >= 95)) throw new Error("Margem mínima inválida");
    if (target !== null && minimum !== null && minimum > target) throw new Error("Margem mínima não pode superar a desejada");
    const payload = {
      tenant_id: context.tenantId,
      product_id: data.productId,
      cost_basis: data.costBasis ?? "auto",
      replacement_cost: money(data.replacementCost, "Custo de reposição", true),
      manual_cost: money(data.manualCost, "Custo manual", true),
      inbound_freight_value: money(data.inboundFreightValue, "Frete de entrada"),
      packaging_cost: money(data.packagingCost, "Embalagem"),
      other_unit_cost: money(data.otherUnitCost, "Outros custos"),
      inventory_loss_pct: pct(data.inventoryLossPct, "Perdas de estoque"),
      target_margin_pct: target,
      min_margin_pct: minimum,
      preferred_channel_id: data.preferredChannelId || null,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    const saved = await sb.from("product_profitability_rules")
      .upsert(payload, { onConflict: "tenant_id,product_id" })
      .select("product_id")
      .single();
    if (saved.error) throw new Error(saved.error.message);

    const simulation = await sb.rpc("simulate_product_profitability", {
      p_tenant_id: context.tenantId,
      p_product_id: data.productId,
      p_channel_id: data.preferredChannelId || null,
      p_target_margin_pct: target,
      p_sale_price: null,
      p_quantity: 1,
    });
    if (simulation.error) throw new Error(simulation.error.message);

    if (data.applyRecommended) {
      const recommended = Number((simulation.data as any)?.recommended_price ?? 0);
      if (!(recommended > 0)) throw new Error("Preço recomendado inválido");
      const applied = await sb.rpc("set_product_b2c_rule", {
        p_tenant_id: context.tenantId,
        p_product_id: data.productId,
        p_mode: "manual",
        p_markup_pct: null,
        p_manual_price: recommended,
      });
      if (applied.error) throw new Error(applied.error.message);
    }
    return { ok: true, simulation: simulation.data, applied: Boolean(data.applyRecommended) };
  });
