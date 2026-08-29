import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";

type ModuleKey =
  | "contacts"
  | "products"
  | "purchase_orders"
  | "sales_orders"
  | "cash_bank"
  | "accounts_receivable"
  | "accounts_payable"
  | "stock"
  | "nfe";

async function requireMigrationAdmin(context: any) {
  await requireTenantRole(context.supabase, context.userId, context.tenantId, ["owner", "admin"]);
}

async function countTenantRows(sb: any, table: string, tenantId: string) {
  const { count, error } = await sb
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export const getMigrationCenter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireMigrationAdmin(context);
    const sb: any = context.supabase;

    const { data: batches, error: batchesError } = await sb
      .from("migration_batches")
      .select(
        "id,source_system,source_name,source_sha256,source_size_bytes,status,manifest,settings,analyzed_at,started_at,completed_at,created_at,updated_at",
      )
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (batchesError) throw new Error(batchesError.message);

    const activeBatch = batches?.[0] ?? null;
    if (!activeBatch) {
      return {
        batches: [],
        activeBatch: null,
        modules: [],
        reconciliations: [],
        attempts: [],
        errors: [],
        summary: { sourceRows: 0, sourceEntities: 0, processed: 0, errors: 0, quarantined: 0 },
      };
    }

    const [modulesResult, reconciliationResult, attemptsResult, errorsResult] = await Promise.all([
      sb
        .from("migration_modules")
        .select(
          "id,module_key,status,source_rows,source_entities,staged_count,matched_count,created_count,updated_count,skipped_count,error_count,quarantined_count,reconciled_count,checkpoint,source_metrics,target_metrics,last_error,started_at,completed_at,last_reconciled_at,updated_at",
        )
        .eq("tenant_id", context.tenantId)
        .eq("batch_id", activeBatch.id)
        .order("created_at", { ascending: true }),
      sb
        .from("migration_reconciliations")
        .select("id,module_key,metric_key,source_value,target_value,delta_value,status,details,checked_at")
        .eq("tenant_id", context.tenantId)
        .eq("batch_id", activeBatch.id)
        .order("module_key")
        .order("metric_key"),
      sb
        .from("migration_attempts")
        .select("id,module_id,action,status,processed_count,error_count,message,started_at,finished_at")
        .eq("tenant_id", context.tenantId)
        .eq("batch_id", activeBatch.id)
        .order("created_at", { ascending: false })
        .limit(25),
      sb
        .from("migration_records")
        .select("id,module_key,external_id,status,error_code,error_message,attempt_count,updated_at")
        .eq("tenant_id", context.tenantId)
        .eq("batch_id", activeBatch.id)
        .in("status", ["error", "quarantined"])
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);

    if (modulesResult.error) throw new Error(modulesResult.error.message);
    if (reconciliationResult.error) throw new Error(reconciliationResult.error.message);
    if (attemptsResult.error) throw new Error(attemptsResult.error.message);
    if (errorsResult.error) throw new Error(errorsResult.error.message);

    const modules = modulesResult.data ?? [];
    const summary = modules.reduce(
      (acc: any, item: any) => {
        acc.sourceRows += Number(item.source_rows ?? 0);
        acc.sourceEntities += Number(item.source_entities ?? 0);
        acc.processed +=
          Number(item.matched_count ?? 0) +
          Number(item.created_count ?? 0) +
          Number(item.updated_count ?? 0) +
          Number(item.skipped_count ?? 0);
        acc.errors += Number(item.error_count ?? 0);
        acc.quarantined += Number(item.quarantined_count ?? 0);
        return acc;
      },
      { sourceRows: 0, sourceEntities: 0, processed: 0, errors: 0, quarantined: 0 },
    );

    return {
      batches: batches ?? [],
      activeBatch,
      modules,
      reconciliations: reconciliationResult.data ?? [],
      attempts: attemptsResult.data ?? [],
      errors: errorsResult.data ?? [],
      summary,
    };
  });

export const retryMigrationModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batchId: string; moduleKey: ModuleKey }) => input)
  .handler(async ({ data, context }) => {
    await requireMigrationAdmin(context);
    const sb: any = context.supabase;
    const { data: result, error } = await sb.rpc("retry_migration_module", {
      p_batch_id: data.batchId,
      p_module_key: data.moduleKey,
    });
    if (error) throw new Error(error.message);
    return result;
  });

export const refreshMigrationReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batchId: string }) => input)
  .handler(async ({ data, context }) => {
    await requireMigrationAdmin(context);
    const sb: any = context.supabase;

    const { data: batch, error: batchError } = await sb
      .from("migration_batches")
      .select("id")
      .eq("id", data.batchId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) throw new Error("Lote de migração não encontrado neste ambiente.");

    const { data: modules, error: modulesError } = await sb
      .from("migration_modules")
      .select(
        "id,module_key,source_entities,matched_count,created_count,updated_count,skipped_count,error_count,quarantined_count",
      )
      .eq("tenant_id", context.tenantId)
      .eq("batch_id", data.batchId);
    if (modulesError) throw new Error(modulesError.message);

    const [products, customers, suppliers, purchaseOrders, orders, stockRows, warehouses, cashMovements, fiscalDocuments] =
      await Promise.all([
        countTenantRows(sb, "products", context.tenantId),
        countTenantRows(sb, "customers", context.tenantId),
        countTenantRows(sb, "suppliers", context.tenantId),
        countTenantRows(sb, "purchase_orders", context.tenantId),
        countTenantRows(sb, "orders", context.tenantId),
        countTenantRows(sb, "product_stock", context.tenantId),
        countTenantRows(sb, "warehouses", context.tenantId),
        countTenantRows(sb, "pos_cash_movements", context.tenantId),
        countTenantRows(sb, "fiscal_documents", context.tenantId),
      ]);

    const targetByModule: Record<ModuleKey, Record<string, unknown>> = {
      contacts: { customers, suppliers },
      products: { products },
      purchase_orders: { purchase_orders: purchaseOrders },
      sales_orders: { orders },
      cash_bank: { pos_cash_movements: cashMovements },
      accounts_receivable: { dedicated_target_ready: false },
      accounts_payable: { dedicated_target_ready: false },
      stock: { product_stock_rows: stockRows, warehouses },
      nfe: { fiscal_documents: fiscalDocuments },
    };

    for (const module of modules ?? []) {
      const key = module.module_key as ModuleKey;
      const processed =
        Number(module.matched_count ?? 0) +
        Number(module.created_count ?? 0) +
        Number(module.updated_count ?? 0) +
        Number(module.skipped_count ?? 0) +
        Number(module.error_count ?? 0) +
        Number(module.quarantined_count ?? 0);
      const expected = Number(module.source_entities ?? 0);
      const failures = Number(module.error_count ?? 0) + Number(module.quarantined_count ?? 0);
      const status = processed === expected && failures === 0 && expected > 0 ? "match" : "warning";

      const { error: updateError } = await sb
        .from("migration_modules")
        .update({ target_metrics: targetByModule[key] ?? {}, last_reconciled_at: new Date().toISOString() })
        .eq("id", module.id)
        .eq("tenant_id", context.tenantId);
      if (updateError) throw new Error(updateError.message);

      const { error: reconciliationError } = await sb.from("migration_reconciliations").upsert(
        {
          batch_id: data.batchId,
          module_id: module.id,
          tenant_id: context.tenantId,
          module_key: key,
          metric_key: "ledger_coverage",
          source_value: { expected_entities: expected },
          target_value: { processed_entities: processed, live_target: targetByModule[key] ?? {} },
          delta_value: { remaining: Math.max(expected - processed, 0), failures },
          status,
          details:
            status === "match"
              ? "Cobertura do ledger completa e sem registros em erro/quarentena."
              : "Cobertura ainda incompleta ou com pendências; nenhuma divergência é aceita automaticamente.",
          checked_at: new Date().toISOString(),
        },
        { onConflict: "batch_id,module_key,metric_key" },
      );
      if (reconciliationError) throw new Error(reconciliationError.message);
    }

    const { error: attemptError } = await sb.from("migration_attempts").insert({
      batch_id: data.batchId,
      tenant_id: context.tenantId,
      action: "reconcile",
      status: "success",
      actor_user_id: context.userId,
      processed_count: modules?.length ?? 0,
      message: "Reconciliação da Central atualizada.",
      finished_at: new Date().toISOString(),
    });
    if (attemptError) throw new Error(attemptError.message);

    return { ok: true, modules: modules?.length ?? 0 };
  });
