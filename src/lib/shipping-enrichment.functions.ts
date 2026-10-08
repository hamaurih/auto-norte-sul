import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupplyRole, SUPPLY_APPROVE_ROLES } from "./supplies.server";

export type ShippingEnrichmentOverview = {
  incomplete: number;
  queued: number;
  processing: number;
  review: number;
  approved: number;
  failed: number;
};

export const getShippingEnrichmentOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ShippingEnrichmentOverview> => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const db = sb as any;

    const { count: incomplete, error: incompleteError } = await db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.tenantId)
      .eq("active", true)
      .or("weight_kg.is.null,height_cm.is.null,width_cm.is.null,length_cm.is.null");
    if (incompleteError) throw new Error(incompleteError.message);

    const countJobs = async (status: string) => {
      const { count, error } = await db
        .from("product_enrichment_jobs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .eq("status", status)
        .like("search_query", "[shipping]%");
      if (error) throw new Error(error.message);
      return Number(count ?? 0);
    };

    const [queued, processing, review, approved, failed] = await Promise.all([
      countJobs("queued"),
      countJobs("processing"),
      countJobs("review"),
      countJobs("approved"),
      countJobs("failed"),
    ]);

    return {
      incomplete: Number(incomplete ?? 0),
      queued,
      processing,
      review,
      approved,
      failed,
    };
  });

export const listShippingEnrichmentJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { status?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const db = sb as any;

    let query = db
      .from("product_enrichment_jobs")
      .select("id,status,attempts,last_error,search_query,created_at,finished_at,product:products(id,name,sku,gtin,manufacturer_code,weight_kg,height_cm,width_cm,length_cm),candidates:product_enrichment_candidates(id,source_type,source_name,source_url,suggested_weight_kg,suggested_height_cm,suggested_width_cm,suggested_length_cm,measurement_basis,measurement_confidence,specifications,confidence,match_reasons,status,review_reason,created_at)")
      .eq("tenant_id", context.tenantId)
      .like("search_query", "[shipping]%")
      .order("created_at", { ascending: false })
      .limit(200);

    if (data.status && data.status !== "all") query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const enqueueShippingMeasurementEnrichment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { limit?: number }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { data: count, error } = await (sb as any).rpc("enqueue_products_for_shipping_enrichment", {
      p_tenant_id: context.tenantId,
      p_limit: Math.max(1, Math.min(Number(data.limit ?? 100), 500)),
    });
    if (error) throw new Error(error.message);
    return { count: Number(count ?? 0) };
  });

export const processShippingMeasurementEnrichment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { limit?: number }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { data: result, error } = await context.supabase.functions.invoke("process-shipping-enrichment", {
      body: {
        limit: Math.max(1, Math.min(Number(data.limit ?? 3), 5)),
        tenantId: context.tenantId,
      },
    });
    if (error) throw new Error(error.message);
    if (!result?.ok) throw new Error(result?.error ?? "Não foi possível pesquisar peso e medidas");
    return result as {
      ok: true;
      processed: number;
      results: Array<{
        jobId: string;
        candidateId?: string;
        status: string;
        reason?: string;
        sourceName?: string;
        sourceUrl?: string;
        measurements?: {
          weightKg: number | null;
          lengthCm: number | null;
          widthCm: number | null;
          heightCm: number | null;
          basis: string;
          confidence: number;
        };
      }>;
    };
  });

export const approveShippingMeasurementCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { candidateId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { data: result, error } = await (sb as any).rpc("approve_product_enrichment_candidate", {
      p_candidate_id: data.candidateId,
    });
    if (error) throw new Error(error.message);
    return result as {
      ok: boolean;
      product_id: string;
      candidate_id: string;
      shipping_fields_applied: number;
    };
  });

export const rejectShippingMeasurementCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { candidateId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { error } = await (sb as any)
      .from("product_enrichment_candidates")
      .update({ status: "rejected", reviewed_by: context.userId, reviewed_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("id", data.candidateId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
