import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";

export type VehicleApplicationCandidateStatus = "pending" | "approved" | "rejected";
export type VehicleApplicationCandidateSource = "official_enrichment" | "product_name" | "manual" | "import";

export const getVehicleApplicationCenterStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any).rpc("get_vehicle_application_center_stats", {
      p_tenant_id: context.tenantId,
    });
    if (error) throw new Error(error.message);
    return {
      activeProducts: Number(data?.active_products ?? 0),
      productsWithApplications: Number(data?.products_with_applications ?? 0),
      productsWithoutApplications: Number(data?.products_without_applications ?? 0),
      publishedApplications: Number(data?.published_applications ?? 0),
      pendingCandidates: Number(data?.pending_candidates ?? 0),
      highConfidencePending: Number(data?.high_confidence_pending ?? 0),
      officialSourcePending: Number(data?.official_source_pending ?? 0),
      approvedCandidates: Number(data?.approved_candidates ?? 0),
      rejectedCandidates: Number(data?.rejected_candidates ?? 0),
    };
  });

export const listVehicleApplicationCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    status?: VehicleApplicationCandidateStatus | "all";
    source?: VehicleApplicationCandidateSource | "all";
    minConfidence?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }) => input)
  .handler(async ({ data, context }) => {
    const limit = Math.min(Math.max(data.limit ?? 100, 1), 250);
    const offset = Math.max(data.offset ?? 0, 0);
    let query = (context.supabase as any)
      .from("vehicle_application_candidates")
      .select(
        "id,product_id,vehicle_make,vehicle_model,year_from,year_to,source_type,source_name,source_url,evidence_text,match_reason,confidence,status,review_notes,created_at,reviewed_at,product:products(id,name,sku,manufacturer_code)",
        { count: "exact" },
      )
      .eq("tenant_id", context.tenantId)
      .order("confidence", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.status && data.status !== "all") query = query.eq("status", data.status);
    if (data.source && data.source !== "all") query = query.eq("source_type", data.source);
    if (typeof data.minConfidence === "number" && data.minConfidence > 0) query = query.gte("confidence", data.minConfidence);
    const search = data.search?.trim();
    if (search) {
      const escaped = search.replace(/[%_,()]/g, " ").trim();
      if (escaped) query = query.or(`vehicle_make.ilike.%${escaped}%,vehicle_model.ilike.%${escaped}%,evidence_text.ilike.%${escaped}%`);
    }

    const { data: rows, error, count } = await query;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: Number(count ?? 0), limit, offset };
  });

export const generateVehicleApplicationCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number }) => input)
  .handler(async ({ data, context }) => {
    const limit = Math.min(Math.max(data.limit ?? 1000, 1), 5000);
    const { data: generated, error } = await (context.supabase as any).rpc(
      "generate_vehicle_application_candidates_from_names",
      { p_tenant_id: context.tenantId, p_limit: limit },
    );
    if (error) throw new Error(error.message);
    return { generated: Number(generated ?? 0) };
  });

export const reviewVehicleApplicationCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    candidateId: string;
    decision: "approve" | "reject";
    vehicleMake?: string | null;
    vehicleModel?: string | null;
    yearFrom?: number | null;
    yearTo?: number | null;
    reviewNotes?: string | null;
  }) => input)
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).rpc("review_vehicle_application_candidate", {
      p_candidate_id: data.candidateId,
      p_decision: data.decision,
      p_vehicle_make: data.vehicleMake ?? null,
      p_vehicle_model: data.vehicleModel ?? null,
      p_year_from: data.yearFrom ?? null,
      p_year_to: data.yearTo ?? null,
      p_review_notes: data.reviewNotes ?? null,
    });
    if (error) throw new Error(error.message);
    return result ?? { ok: true };
  });

export const listPublishedVehicleApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number; offset?: number }) => input)
  .handler(async ({ data, context }) => {
    const limit = Math.min(Math.max(data.limit ?? 100, 1), 250);
    const offset = Math.max(data.offset ?? 0, 0);
    const { data: rows, error, count } = await (context.supabase as any)
      .from("product_applications")
      .select(
        "id,product_id,vehicle_make,vehicle_model,year_from,year_to,notes,source_type,source_name,source_url,confidence,verified_at,product:products(id,name,sku,manufacturer_code)",
        { count: "exact" },
      )
      .eq("tenant_id", context.tenantId)
      .order("verified_at", { ascending: false, nullsFirst: false })
      .order("vehicle_make", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: Number(count ?? 0), limit, offset };
  });
