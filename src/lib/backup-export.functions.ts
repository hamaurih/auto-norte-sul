import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireTenantRole } from "@/lib/auth-guards";

export type ExportType = "products" | "customers" | "stock" | "sales" | "financial" | "fiscal";
export type ExportFormat = "csv" | "json";

type ExportInput = {
  type: ExportType;
  format: ExportFormat;
  startDate?: string;
  endDate?: string;
};

const definitions: Record<
  ExportType,
  {
    table: string;
    select: string;
    order: string;
    dateColumn?: string;
    dateOnly?: boolean;
  }
> = {
  products: {
    table: "products",
    select:
      "id,sku,internal_code,gtin,name,price_b2c,price_b2b,average_cost,last_purchase_cost,stock,min_stock,active,available_for_online,created_at,updated_at",
    order: "name",
  },
  customers: {
    table: "customers",
    select:
      "id,name,trade_name,document,email,phone,customer_group,b2b_status,city,state,active,source,bling_id,created_at,updated_at",
    order: "name",
  },
  stock: {
    table: "product_stock",
    select:
      "product_id,warehouse_id,on_hand,reserved,min_stock,updated_at,products(sku,name),warehouses(code,name)",
    order: "updated_at",
  },
  sales: {
    table: "orders",
    select:
      "id,bling_number,status,customer_id,customer_name,subtotal,discount,shipping,total,payment_method,sales_channel_id,created_at,updated_at",
    order: "created_at",
    dateColumn: "created_at",
  },
  financial: {
    table: "financial_transactions",
    select:
      "id,account_id,transaction_date,direction,amount,description,category,reconciliation_status,external_reference,created_at",
    order: "transaction_date",
    dateColumn: "transaction_date",
    dateOnly: true,
  },
  fiscal: {
    table: "fiscal_documents",
    select:
      "id,model,environment,status,series,number,access_key,recipient_name,recipient_tax_id,totals,issued_at,authorized_at,created_at",
    order: "created_at",
    dateColumn: "created_at",
  },
};

function validateInput(input: ExportInput): ExportInput {
  if (!Object.hasOwn(definitions, input.type)) throw new Error("Módulo de exportação inválido");
  if (!(["csv", "json"] as string[]).includes(input.format)) throw new Error("Formato inválido");
  if (input.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate))
    throw new Error("Data inicial inválida");
  if (input.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate))
    throw new Error("Data final inválida");
  if (input.startDate && input.endDate && input.startDate > input.endDate)
    throw new Error("A data inicial deve ser anterior à final");
  return input;
}

function flatten(value: unknown, prefix = "", result: Record<string, unknown> = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      flatten(nested, prefix ? `${prefix}.${key}` : key, result);
    }
  } else result[prefix] = value;
  return result;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : Array.isArray(value) ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "\uFEFF";
  const flattened = rows.map((row) => flatten(row));
  const headers = Array.from(new Set(flattened.flatMap((row) => Object.keys(row))));
  return `\uFEFF${headers.map(csvCell).join(";")}\n${flattened.map((row) => headers.map((key) => csvCell(row[key])).join(";")).join("\n")}`;
}

async function exportRows(sb: ReturnType<typeof tdb>, input: ExportInput) {
  const definition = definitions[input.type];
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    let query = sb
      .from(definition.table)
      .select(definition.select)
      .order(definition.order, { ascending: true })
      .range(from, from + pageSize - 1);
    if (definition.dateColumn && input.startDate)
      query = query.gte(
        definition.dateColumn,
        definition.dateOnly ? input.startDate : `${input.startDate}T00:00:00-03:00`,
      );
    if (definition.dateColumn && input.endDate)
      query = query.lte(
        definition.dateColumn,
        definition.dateOnly ? input.endDate : `${input.endDate}T23:59:59-03:00`,
      );
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < pageSize) return rows;
  }
  throw new Error("A exportação ultrapassou 50.000 registros. Reduza o período.");
}

export const getBackupExportCenter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    await requireTenantRole(sb, context.userId, context.tenantId, ["owner", "admin"]);
    const [{ data: jobs, error: jobsError }, { data: requests, error: requestsError }] =
      await Promise.all([
        sb
          .from("backup_export_jobs")
          .select(
            "id,export_type,file_format,status,file_name,row_count,byte_size,error_message,requested_by,created_at,completed_at",
          )
          .eq("tenant_id", context.tenantId)
          .order("created_at", { ascending: false })
          .limit(50),
        sb
          .from("backup_restore_requests")
          .select(
            "id,reason,requested_snapshot_at,status,requested_by,reviewed_by,review_notes,created_at",
          )
          .eq("tenant_id", context.tenantId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
    if (jobsError) throw new Error(jobsError.message);
    if (requestsError) throw new Error(requestsError.message);
    return { jobs: jobs ?? [], restoreRequests: requests ?? [] };
  });

export const generateOperationalExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateInput)
  .handler(async ({ data: input, context }) => {
    const sb = tdb(context.supabase);
    await requireTenantRole(sb, context.userId, context.tenantId, ["owner", "admin"]);
    const filters = { start_date: input.startDate ?? null, end_date: input.endDate ?? null };
    const { data: job, error: createError } = await sb
      .from("backup_export_jobs")
      .insert({
        tenant_id: context.tenantId,
        export_type: input.type,
        file_format: input.format,
        status: "processing",
        filters,
        requested_by: context.userId,
      })
      .select("id")
      .single();
    if (createError) throw new Error(createError.message);

    try {
      const rows = await exportRows(sb, input);
      const content = input.format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `norte-sul-${input.type}-${stamp}.${input.format}`;
      const byteSize = new TextEncoder().encode(content).byteLength;
      const { error: finishError } = await sb
        .from("backup_export_jobs")
        .update({
          status: "completed",
          file_name: fileName,
          row_count: rows.length,
          byte_size: byteSize,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("tenant_id", context.tenantId);
      if (finishError) throw new Error(finishError.message);
      return {
        content,
        fileName,
        mimeType: input.format === "csv" ? "text/csv;charset=utf-8" : "application/json",
        rowCount: rows.length,
        byteSize,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida";
      await sb
        .from("backup_export_jobs")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("tenant_id", context.tenantId);
      throw new Error(message);
    }
  });

export const requestBackupRestore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reason: string; snapshotAt: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireTenantRole(sb, context.userId, context.tenantId, ["owner", "admin"]);
    const reason = data.reason.trim();
    if (reason.length < 10 || reason.length > 2000)
      throw new Error("Informe um motivo entre 10 e 2.000 caracteres");
    const snapshotAt = new Date(data.snapshotAt);
    if (Number.isNaN(snapshotAt.getTime()) || snapshotAt > new Date())
      throw new Error("Informe uma data de backup válida e anterior ao momento atual");
    const { error } = await sb.from("backup_restore_requests").insert({
      tenant_id: context.tenantId,
      reason,
      requested_snapshot_at: snapshotAt.toISOString(),
      requested_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
