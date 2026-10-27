import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";

const CUTOVER_DATE = "2026-10-21";
const FINANCE_ROLES = ["owner", "admin", "manager", "finance"] as const;

const dashboardSchema = z.object({
  scope: z.enum(["current", "legacy"]).default("current"),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  page: z.number().int().min(0).max(1000).default(0),
  pageSize: z.number().int().min(20).max(200).default(100),
});

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export const getFinancialReconciliationDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => dashboardSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await requireTenantRole(context.supabase as any, context.userId, context.tenantId, [...FINANCE_ROLES]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const startDate = data.startDate ?? monthStart();
    const endDate = data.endDate ?? today();

    const [accountsResult, channelSummaryResult] = await Promise.all([
      db.from("financial_accounts")
        .select("id,name,account_type,institution_name,system_code,opening_balance,opening_balance_as_of,opening_balance_verified_at,active")
        .eq("tenant_id", context.tenantId)
        .eq("active", true)
        .order("name"),
      db.rpc("financial_channel_summary", {
        p_tenant_id: context.tenantId,
        p_start_date: startDate,
        p_end_date: endDate,
      }),
    ]);
    if (accountsResult.error) throw new Error(accountsResult.error.message);
    if (channelSummaryResult.error) throw new Error(channelSummaryResult.error.message);

    const accounts = accountsResult.data ?? [];
    const unverifiedAccounts = accounts.filter((a: any) =>
      a.name !== "Bling — Caixa/Bancos (histórico)" &&
      !String(a.system_code ?? "").startsWith("clearing:") &&
      !a.opening_balance_verified_at
    );

    if (data.scope === "legacy") {
      const offset = data.page * data.pageSize;
      const [summaryResult, queueResult] = await Promise.all([
        db.rpc("financial_reconciliation_queue_summary", {
          p_tenant_id: context.tenantId,
        }),
        db.rpc("financial_reconciliation_unmatched_queue", {
          p_tenant_id: context.tenantId,
          p_limit: data.pageSize,
          p_offset: offset,
        }),
      ]);
      if (summaryResult.error) throw new Error(summaryResult.error.message);
      if (queueResult.error) throw new Error(queueResult.error.message);

      return {
        scope: "legacy" as const,
        cutoverDate: CUTOVER_DATE,
        startDate,
        endDate,
        accounts,
        unverifiedAccounts,
        channelSummary: channelSummaryResult.data ?? {},
        current: null,
        legacy: {
          summary: summaryResult.data ?? {},
          queue: queueResult.data ?? { total: 0, rows: [], limit: data.pageSize, offset },
        },
      };
    }

    const [transactionsResult, receivablesResult, payablesResult] = await Promise.all([
      db.from("financial_transactions")
        .select("id,account_id,transaction_date,direction,amount,description,category,reconciliation_status,source_type,external_reference,order_id,sales_channel_id,payment_method,created_at,account:financial_accounts(name,institution_name),sales_channel:sales_channels(code,name)")
        .eq("tenant_id", context.tenantId)
        .gte("transaction_date", CUTOVER_DATE)
        .neq("source_type", "bling_cash_banks")
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000),
      db.from("financial_receivables")
        .select("id,order_id,source_type,source_id,sales_channel_id,customer_name,description,amount,received_amount,due_date,payment_method,status,created_at,sales_channel:sales_channels(code,name)")
        .eq("tenant_id", context.tenantId)
        .neq("source_type", "bling_backup")
        .order("due_date", { ascending: true })
        .limit(2000),
      db.from("expenses")
        .select("id,source_type,sales_channel_id,description,amount,paid_amount,due_date,status,approval_status,supplier_name,created_at,sales_channel:sales_channels(code,name)")
        .eq("tenant_id", context.tenantId)
        .neq("source_type", "bling_backup")
        .order("due_date", { ascending: true })
        .limit(2000),
    ]);
    for (const result of [transactionsResult, receivablesResult, payablesResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const transactions = transactionsResult.data ?? [];
    const receivables = receivablesResult.data ?? [];
    const payables = payablesResult.data ?? [];

    const transactionCounts = {
      pending: transactions.filter((t: any) => t.reconciliation_status === "pending").length,
      partial: transactions.filter((t: any) => t.reconciliation_status === "partial").length,
      matched: transactions.filter((t: any) => t.reconciliation_status === "matched").length,
      ignored: transactions.filter((t: any) => t.reconciliation_status === "ignored").length,
    };

    const openReceivables = receivables.filter((r: any) => r.status === "open");
    const openPayables = payables.filter((p: any) => p.status === "open" && p.approval_status === "approved");
    const pendingTransactions = transactions.filter((t: any) =>
      t.reconciliation_status === "pending" || t.reconciliation_status === "partial"
    );

    const totalPending = pendingTransactions.reduce((sum: number, t: any) => sum + Number(t.amount ?? 0), 0);
    const totalReceivableOpen = openReceivables.reduce((sum: number, r: any) =>
      sum + Math.max(Number(r.amount ?? 0) - Number(r.received_amount ?? 0), 0), 0);
    const totalPayableOpen = openPayables.reduce((sum: number, p: any) =>
      sum + Math.max(Number(p.amount ?? 0) - Number(p.paid_amount ?? 0), 0), 0);

    const start = data.page * data.pageSize;
    const pagedPending = pendingTransactions.slice(start, start + data.pageSize);

    return {
      scope: "current" as const,
      cutoverDate: CUTOVER_DATE,
      startDate,
      endDate,
      accounts,
      unverifiedAccounts,
      channelSummary: channelSummaryResult.data ?? {},
      legacy: null,
      current: {
        transactionCounts,
        totalTransactions: transactions.length,
        pendingTransactions: pagedPending,
        pendingTotal: totalPending,
        totalPendingTransactions: pendingTransactions.length,
        openReceivables,
        openPayables,
        openReceivablesTotal: totalReceivableOpen,
        openPayablesTotal: totalPayableOpen,
        reconciliationReady: transactionCounts.pending === 0 && transactionCounts.partial === 0,
        cashCloseReady: transactionCounts.pending === 0 && transactionCounts.partial === 0 && unverifiedAccounts.length === 0,
      },
    };
  });

export const reconcileCurrentFinancialTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    transactionId: z.string().uuid(),
    targetType: z.enum(["receivable", "payable"]),
    targetId: z.string().uuid(),
    amount: z.number().positive().optional(),
    notes: z.string().trim().max(1000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await requireTenantRole(context.supabase as any, context.userId, context.tenantId, [...FINANCE_ROLES]);
    const sb = context.supabase as any;

    const { data: tx, error: txError } = await sb.from("financial_transactions")
      .select("id,tenant_id,source_type,transaction_date,reconciliation_status")
      .eq("id", data.transactionId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (txError) throw new Error(txError.message);
    if (!tx) throw new Error("Movimento não encontrado.");
    if (tx.source_type === "bling_cash_banks" || String(tx.transaction_date) < CUTOVER_DATE) {
      throw new Error("Movimento histórico do Bling não pode ser conciliado na operação atual.");
    }

    const { data: result, error } = await sb.rpc("reconcile_financial_transaction", {
      p_transaction_id: data.transactionId,
      p_target_type: data.targetType,
      p_target_id: data.targetId,
      p_amount: data.amount ?? null,
      p_notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    return result;
  });

export const runLegacyFinancialReconciliationAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireTenantRole(context.supabase as any, context.userId, context.tenantId, ["owner", "admin", "manager", "finance"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("run_smart_financial_reconciliation", {
      p_tenant_id: context.tenantId,
      p_auto_apply: false,
    });
    if (error) throw new Error(error.message);
    return data;
  });
