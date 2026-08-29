import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

type SellerCreditEntry = {
  id: string;
  entry_type: string;
  amount: number;
  description: string;
  created_at: string;
};

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

async function getAdminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return tdb(supabaseAdmin);
}

export const getMySellerCredit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const adminSb = await getAdminDb();
    const { data: rep, error: repError } = await adminSb
      .from("sales_reps")
      .select("id")
      .eq("tenant_id", context.tenantId)
      .eq("user_id", context.userId)
      .eq("active", true)
      .maybeSingle();

    if (repError) throw new Error(repError.message);
    if (!rep) {
      return {
        isSalesRep: false,
        enabled: false,
        availableBalance: 0,
        maxUpliftPct: 0,
        recent: [] as SellerCreditEntry[],
      };
    }

    const [{ data: settings, error: settingsError }, { data: ledger, error: ledgerError }, { data: balance, error: balanceError }] =
      await Promise.all([
        adminSb
          .from("seller_credit_settings")
          .select("enabled, max_uplift_pct, max_credit_use_pct")
          .eq("tenant_id", context.tenantId)
          .maybeSingle(),
        adminSb
          .from("seller_credit_ledger")
          .select("id, entry_type, amount, description, created_at")
          .eq("tenant_id", context.tenantId)
          .eq("rep_id", rep.id)
          .order("created_at", { ascending: false })
          .limit(20),
        (adminSb as any).rpc("get_seller_credit_balance", {
          p_tenant_id: context.tenantId,
          p_rep_id: rep.id,
        }),
      ]);

    if (settingsError) throw new Error(settingsError.message);
    if (ledgerError) throw new Error(ledgerError.message);
    if (balanceError) throw new Error(balanceError.message);

    return {
      isSalesRep: true,
      enabled: Boolean(settings?.enabled ?? false),
      availableBalance: Number(balance ?? 0),
      maxUpliftPct: Number(settings?.max_uplift_pct ?? 0),
      recent: (ledger ?? []).map((row: any) => ({
        id: row.id,
        entry_type: row.entry_type,
        amount: Number(row.amount ?? 0),
        description: row.description,
        created_at: row.created_at,
      })),
    };
  });

const creditSettingsSchema = z.object({
  enabled: z.boolean(),
  max_uplift_pct: z.number().min(0).max(100),
  tax_rate_pct: z.number().min(0).max(100),
  max_credit_use_pct: z.number().min(0).max(100),
});

export const getSellerCreditAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireManager(tdb(context.supabase), context.userId, context.tenantId);
    const adminSb = await getAdminDb();

    const [{ data: settings, error: settingsError }, { data: reps, error: repsError }, { data: ledger, error: ledgerError }, { data: balances, error: balancesError }] =
      await Promise.all([
        adminSb
          .from("seller_credit_settings")
          .select("enabled, max_uplift_pct, tax_rate_pct, max_credit_use_pct")
          .eq("tenant_id", context.tenantId)
          .maybeSingle(),
        adminSb
          .from("sales_reps")
          .select("id, full_name, email, active")
          .eq("tenant_id", context.tenantId)
          .order("full_name"),
        adminSb
          .from("seller_credit_ledger")
          .select("id, rep_id, entry_type, amount, gross_amount, tax_amount, description, created_at")
          .eq("tenant_id", context.tenantId)
          .order("created_at", { ascending: false })
          .limit(500),
        (adminSb as any).rpc("get_seller_credit_balances", {
          p_tenant_id: context.tenantId,
        }),
      ]);

    if (settingsError) throw new Error(settingsError.message);
    if (repsError) throw new Error(repsError.message);
    if (ledgerError) throw new Error(ledgerError.message);
    if (balancesError) throw new Error(balancesError.message);

    const entries = (ledger ?? []).map((row: any) => ({
      id: row.id,
      rep_id: row.rep_id,
      entry_type: row.entry_type,
      amount: Number(row.amount ?? 0),
      gross_amount: Number(row.gross_amount ?? 0),
      tax_amount: Number(row.tax_amount ?? 0),
      description: row.description,
      created_at: row.created_at,
    }));
    const balanceByRep = new Map<string, number>(
      (balances ?? []).map((row: { rep_id: string; balance: number }) => [
        row.rep_id,
        Number(row.balance ?? 0),
      ]),
    );

    return {
      settings: {
        enabled: Boolean(settings?.enabled ?? false),
        max_uplift_pct: Number(settings?.max_uplift_pct ?? 3),
        tax_rate_pct: Number(settings?.tax_rate_pct ?? 0),
        max_credit_use_pct: Number(settings?.max_credit_use_pct ?? 100),
      },
      accounts: (reps ?? []).map((rep: any) => ({
        id: rep.id,
        full_name: rep.full_name,
        email: rep.email,
        active: Boolean(rep.active),
        balance: Number((balanceByRep.get(rep.id) ?? 0).toFixed(2)),
      })),
      recent: entries.slice(0, 50),
    };
  });

export const saveSellerCreditSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => creditSettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireManager(tdb(context.supabase), context.userId, context.tenantId);
    const adminSb = await getAdminDb();
    const { error } = await adminSb
      .from("seller_credit_settings")
      .upsert(
        {
          tenant_id: context.tenantId,
          enabled: data.enabled,
          max_uplift_pct: data.max_uplift_pct,
          tax_rate_pct: data.tax_rate_pct,
          max_credit_use_pct: data.max_credit_use_pct,
          updated_by: context.userId,
        },
        { onConflict: "tenant_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
