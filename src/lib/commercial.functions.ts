import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PriceTable = "A" | "B" | "C";

export type CommercialAdminData = {
  priceSettings: {
    table_a_discount_pct: number;
    table_b_discount_pct: number;
    table_c_discount_pct: number;
    active: boolean;
  };
  commissionSettings: {
    enabled: boolean;
    average_months: number;
    outperform_rate_pct: number;
    baseline_rate_pct: number;
  };
  customers: Array<{
    id: string;
    name: string;
    document: string | null;
    customer_group: string;
    b2b_status: string;
    price_table: PriceTable | null;
  }>;
  reps: Array<{
    id: string;
    full_name: string;
    email: string;
    commission_pct: number;
    max_discount_pct: number;
    active: boolean;
  }>;
  goals: Array<{
    id: string;
    rep_id: string;
    period_month: string;
    target_amount: number;
    target_units: number;
    notes: string | null;
  }>;
  commissions: Array<{
    id: string;
    rep_id: string;
    period_month: string;
    eligible_sales: number;
    previous_three_months_average: number;
    rate_pct: number;
    commission_amount: number;
    status: string;
  }>;
};

function normalizeCnpj(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

async function requireManager(sb: any, userId: string, tenantId: string) {
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true);

  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((row: { role: string }) =>
    ["owner", "admin", "manager"].includes(row.role),
  );
  if (!membership) throw new Error("Usuário sem permissão gerencial");
  return membership;
}

async function requireTenantMember(sb: any, userId: string, tenantId: string) {
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Usuário sem acesso ao ambiente ativo");
  return data as { role: string };
}

const priceSettingsSchema = z.object({
  table_a_discount_pct: z.number().min(0).max(100),
  table_b_discount_pct: z.number().min(0).max(100),
  table_c_discount_pct: z.number().min(0).max(100),
  active: z.boolean().default(true),
}).refine(
  (value) =>
    value.table_a_discount_pct >= value.table_b_discount_pct &&
    value.table_b_discount_pct >= value.table_c_discount_pct,
  "A tabela A não pode ter desconto menor que B, nem B menor que C",
);

export const getMyCommercialSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    await requireTenantMember(sb, context.userId, context.tenantId);

    const { data: rep, error } = await sb
      .from("sales_reps")
      .select("id, max_discount_pct, can_sell_b2b")
      .eq("tenant_id", context.tenantId)
      .eq("user_id", context.userId)
      .eq("active", true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return {
      isSalesRep: Boolean(rep),
      repId: rep?.id ?? null,
      maxDiscountPct: Number(rep?.max_discount_pct ?? 0),
      canSellB2B: Boolean(rep?.can_sell_b2b ?? false),
    };
  });

export const getB2BPriceContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ cnpj: z.string().max(30).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireTenantMember(sb, context.userId, context.tenantId);

    const [{ data: settings, error: settingsError }, digits] = await Promise.all([
      sb
        .from("b2b_price_table_settings")
        .select("table_a_discount_pct, table_b_discount_pct, table_c_discount_pct, active")
        .eq("tenant_id", context.tenantId)
        .maybeSingle(),
      Promise.resolve(normalizeCnpj(data.cnpj)),
    ]);
    if (settingsError) throw new Error(settingsError.message);

    let priceTable: PriceTable = "C";
    if (digits.length === 14) {
      const { data: assignment, error } = await sb
        .from("b2b_customer_price_tables")
        .select("price_table")
        .eq("tenant_id", context.tenantId)
        .eq("cnpj_digits", digits)
        .eq("active", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (assignment?.price_table === "A" || assignment?.price_table === "B" || assignment?.price_table === "C") {
        priceTable = assignment.price_table;
      }
    }

    const discountPct =
      priceTable === "A"
        ? Number(settings?.table_a_discount_pct ?? 8)
        : priceTable === "B"
          ? Number(settings?.table_b_discount_pct ?? 5)
          : Number(settings?.table_c_discount_pct ?? 0);

    return {
      priceTable,
      discountPct,
      configured: Boolean(settings?.active ?? true),
      cnpjDigits: digits.length === 14 ? digits : null,
    };
  });

export const getCommercialAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    await requireManager(sb, context.userId, context.tenantId);
    // Comissão é dado gerencial: esta leitura usa service role somente depois da checagem de gerente/admin.
    const adminSb = tdb(supabaseAdmin);

    const [settingsResult, commissionSettingsResult, customersResult, assignmentsResult, repsResult, goalsResult, commissionsResult] =
      await Promise.all([
        sb
          .from("b2b_price_table_settings")
          .select("table_a_discount_pct, table_b_discount_pct, table_c_discount_pct, active")
          .eq("tenant_id", context.tenantId)
          .maybeSingle(),
        sb
          .from("seller_commission_settings")
          .select("enabled, average_months, outperform_rate_pct, baseline_rate_pct")
          .eq("tenant_id", context.tenantId)
          .maybeSingle(),
        sb
          .from("customers")
          .select("id, name, document, customer_group, b2b_status")
          .eq("tenant_id", context.tenantId)
          .eq("active", true)
          .order("name")
          .limit(500),
        sb
          .from("b2b_customer_price_tables")
          .select("customer_id, price_table")
          .eq("tenant_id", context.tenantId)
          .eq("active", true),
        adminSb
          .from("sales_reps")
          .select("id, full_name, email, commission_pct, max_discount_pct, active")
          .eq("tenant_id", context.tenantId)
          .order("full_name"),
        sb
          .from("seller_goals")
          .select("id, rep_id, period_month, target_amount, target_units, notes")
          .eq("tenant_id", context.tenantId)
          .order("period_month", { ascending: false })
          .limit(200),
        sb
          .from("seller_commission_periods")
          .select("id, rep_id, period_month, eligible_sales, previous_three_months_average, rate_pct, commission_amount, status")
          .eq("tenant_id", context.tenantId)
          .order("period_month", { ascending: false })
          .limit(200),
      ]);

    const firstError =
      settingsResult.error ??
      commissionSettingsResult.error ??
      customersResult.error ??
      assignmentsResult.error ??
      repsResult.error ??
      goalsResult.error ??
      commissionsResult.error;
    if (firstError) throw new Error(firstError.message);

    const assignmentByCustomer = new Map(
      (assignmentsResult.data ?? []).map((row: { customer_id: string; price_table: string }) => [
        row.customer_id,
        (row.price_table === "A" || row.price_table === "B" || row.price_table === "C"
          ? row.price_table
          : null) as PriceTable | null,
      ] as [string, PriceTable | null]),
    );

    return {
      priceSettings: {
        table_a_discount_pct: Number(settingsResult.data?.table_a_discount_pct ?? 8),
        table_b_discount_pct: Number(settingsResult.data?.table_b_discount_pct ?? 5),
        table_c_discount_pct: Number(settingsResult.data?.table_c_discount_pct ?? 0),
        active: Boolean(settingsResult.data?.active ?? true),
      },
      commissionSettings: {
        enabled: Boolean(commissionSettingsResult.data?.enabled ?? true),
        average_months: Number(commissionSettingsResult.data?.average_months ?? 3),
        outperform_rate_pct: Number(commissionSettingsResult.data?.outperform_rate_pct ?? 1),
        baseline_rate_pct: Number(commissionSettingsResult.data?.baseline_rate_pct ?? 0.5),
      },
      customers: (customersResult.data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        document: row.document,
        customer_group: row.customer_group,
        b2b_status: row.b2b_status,
        price_table: assignmentByCustomer.get(row.id) ?? null,
      })),
      reps: (repsResult.data ?? []).map((row: any) => ({
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        commission_pct: Number(row.commission_pct ?? 0),
        max_discount_pct: Number(row.max_discount_pct ?? 0),
        active: Boolean(row.active),
      })),
      goals: (goalsResult.data ?? []).map((row: any) => ({
        ...row,
        target_amount: Number(row.target_amount ?? 0),
        target_units: Number(row.target_units ?? 0),
      })),
      commissions: (commissionsResult.data ?? []).map((row: any) => ({
        ...row,
        eligible_sales: Number(row.eligible_sales ?? 0),
        previous_three_months_average: Number(row.previous_three_months_average ?? 0),
        rate_pct: Number(row.rate_pct ?? 0),
        commission_amount: Number(row.commission_amount ?? 0),
      })),
    } satisfies CommercialAdminData;
  });

export const saveB2BPriceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => priceSettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireManager(sb, context.userId, context.tenantId);

    const { error } = await sb
      .from("b2b_price_table_settings")
      .upsert(
        {
          tenant_id: context.tenantId,
          table_a_discount_pct: data.table_a_discount_pct,
          table_b_discount_pct: data.table_b_discount_pct,
          table_c_discount_pct: data.table_c_discount_pct,
          active: data.active,
          updated_by: context.userId,
        },
        { onConflict: "tenant_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveCustomerPriceTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    customer_id: z.string().uuid(),
    price_table: z.enum(["A", "B", "C"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireManager(sb, context.userId, context.tenantId);

    const { data: customer, error: customerError } = await sb
      .from("customers")
      .select("id, document")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.customer_id)
      .maybeSingle();
    if (customerError) throw new Error(customerError.message);
    const cnpjDigits = normalizeCnpj(customer?.document);
    if (!customer || cnpjDigits.length !== 14) {
      throw new Error("O cliente precisa ter um CNPJ válido antes de receber uma tabela B2B");
    }

    const { error } = await sb
      .from("b2b_customer_price_tables")
      .upsert(
        {
          tenant_id: context.tenantId,
          customer_id: customer.id,
          cnpj_digits: cnpjDigits,
          price_table: data.price_table,
          active: true,
          updated_by: context.userId,
        },
        { onConflict: "tenant_id,customer_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveSalesRepSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    rep_id: z.string().uuid(),
    max_discount_pct: z.number().min(0).max(100),
    commission_pct: z.number().min(0).max(100),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireManager(sb, context.userId, context.tenantId);

    const { error } = await sb
      .from("sales_reps")
      .update({
        max_discount_pct: data.max_discount_pct,
        commission_pct: data.commission_pct,
      })
      .eq("id", data.rep_id)
      .eq("tenant_id", context.tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveSellerGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    rep_id: z.string().uuid(),
    period_month: z.string().regex(/^\d{4}-\d{2}$/),
    target_amount: z.number().min(0).max(999999999),
    target_units: z.number().int().min(0).max(999999999),
    notes: z.string().trim().max(500).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireManager(sb, context.userId, context.tenantId);
    const periodMonth = data.period_month + "-01";

    const { error } = await sb
      .from("seller_goals")
      .upsert(
        {
          tenant_id: context.tenantId,
          rep_id: data.rep_id,
          period_month: periodMonth,
          target_amount: data.target_amount,
          target_units: data.target_units,
          notes: data.notes?.trim() || null,
          updated_by: context.userId,
        },
        { onConflict: "tenant_id,rep_id,period_month" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const calculateSellerCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    rep_id: z.string().uuid(),
    period_month: z.string().regex(/^\d{4}-\d{2}$/),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireManager(sb, context.userId, context.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: result, error } = await (supabaseAdmin as any).rpc(
      "calculate_seller_commission",
      {
        p_tenant_id: context.tenantId,
        p_rep_id: data.rep_id,
        p_period_month: data.period_month + "-01",
        p_actor_user_id: context.userId,
      },
    );
    if (error) throw new Error(error.message);
    return result;
  });
