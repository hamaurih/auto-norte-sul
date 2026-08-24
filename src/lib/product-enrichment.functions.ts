import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupplyRole, SUPPLY_APPROVE_ROLES } from "./supplies.server";

export type EnrichmentCandidateInput = {
  jobId: string;
  productId: string;
  sourceType: "bling" | "gs1" | "manufacturer" | "supplier" | "authorized_distributor" | "web" | "manual";
  sourceName?: string;
  sourceUrl: string;
  licenseName?: string;
  licenseUrl?: string;
  imageUrl?: string;
  suggestedName?: string;
  shortDescription?: string;
  description?: string;
  gtin?: string;
  manufacturerCode?: string;
  confidence: number;
  matchReasons?: string[];
};

export const listProductEnrichmentJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { status?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    let query = sb.from("product_enrichment_jobs")
      .select("id,status,trigger_source,search_query,attempts,last_error,created_at,product:products(id,name,sku,gtin,manufacturer_code,description,short_description),candidates:product_enrichment_candidates(id,source_type,source_name,source_url,license_name,license_url,image_url,storage_url,suggested_name,suggested_short_description,suggested_description,suggested_gtin,suggested_manufacturer_code,confidence,match_reasons,status)")
      .eq("tenant_id", context.tenantId).order("created_at", { ascending: false }).limit(150);
    if (data.status && data.status !== "all") query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const enqueueMissingProductEnrichment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { limit?: number }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { data: count, error } = await sb.rpc("enqueue_products_for_enrichment", {
      p_tenant_id: context.tenantId,
      p_limit: Math.max(1, Math.min(Number(data.limit ?? 100), 500)),
    });
    if (error) throw new Error(error.message);
    return { count: Number(count ?? 0) };
  });

export const addProductEnrichmentCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: EnrichmentCandidateInput) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    let parsed: URL;
    try { parsed = new URL(data.sourceUrl); } catch { throw new Error("URL da fonte inválida"); }
    if (parsed.protocol !== "https:") throw new Error("A fonte precisa usar HTTPS");
    const imageUrl = data.imageUrl?.trim() || null;
    if (imageUrl) {
      let image: URL;
      try { image = new URL(imageUrl); } catch { throw new Error("URL da imagem inválida"); }
      if (image.protocol !== "https:") throw new Error("A imagem precisa usar HTTPS");
    }
    const confidence = Math.max(0, Math.min(Number(data.confidence ?? 0), 100));
    const { error } = await sb.from("product_enrichment_candidates").insert({
      tenant_id: context.tenantId, job_id: data.jobId, product_id: data.productId,
      source_type: data.sourceType, source_name: data.sourceName?.trim() || parsed.hostname,
      source_url: parsed.toString(), license_name: data.licenseName?.trim() || null,
      license_url: data.licenseUrl?.trim() || null, image_url: imageUrl,
      suggested_name: data.suggestedName?.trim() || null,
      suggested_short_description: data.shortDescription?.trim() || null,
      suggested_description: data.description?.trim() || null,
      suggested_gtin: data.gtin?.replace(/\D/g, "") || null,
      suggested_manufacturer_code: data.manufacturerCode?.trim() || null,
      confidence, match_reasons: data.matchReasons ?? [], created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    const { error: jobError } = await sb.from("product_enrichment_jobs")
      .update({ status: "review", last_error: null }).eq("tenant_id", context.tenantId).eq("id", data.jobId);
    if (jobError) throw new Error(jobError.message);
    return { ok: true };
  });

export const copyProductEnrichmentImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: { candidateId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { data: result, error } = await context.supabase.functions.invoke("copy-product-enrichment-image", {
      body: { candidateId: data.candidateId },
    });
    if (error) throw new Error(error.message);
    if (!result?.ok) throw new Error(result?.error ?? "Não foi possível copiar a imagem");
    return result as { ok: true; storageUrl: string };
  });

export const approveProductEnrichmentCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: { candidateId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { data: result, error } = await sb.rpc("approve_product_enrichment_candidate", { p_candidate_id: data.candidateId });
    if (error) throw new Error(error.message);
    return result as { ok: boolean; product_id: string };
  });

export const rejectProductEnrichmentCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: { candidateId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { error } = await sb.from("product_enrichment_candidates")
      .update({ status: "rejected", reviewed_by: context.userId, reviewed_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId).eq("id", data.candidateId).eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const processManufacturerEnrichment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { limit?: number }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { data: result, error } = await context.supabase.functions.invoke("process-manufacturer-enrichment", {
      body: { limit: Math.max(1, Math.min(Number(data.limit ?? 3), 5)) },
    });
    if (error) throw new Error(error.message);
    if (!result?.ok) throw new Error(result?.error ?? "Não foi possível processar a fila");
    return result as { ok: true; processed: number; results: Array<{ jobId: string; status: string; sourceUrl?: string; reason?: string }> };
  });


export type EnqueueNfeItemEnrichmentResult = {
  ok: boolean;
  jobId: string;
  reused: boolean;
  searchQuery: string;
};

export const enqueueNfeItemEnrichment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nfeItemId: string }) => input)
  .handler(async ({ data, context }): Promise<EnqueueNfeItemEnrichmentResult> => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);

    const { data: item, error } = await sb
      .from("nfe_import_items")
      .select("id, product_id, supplier_code, gtin, description, product:products(id,name,sku,gtin,manufacturer_code,internal_code)")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.nfeItemId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!item) throw new Error("Item da NF-e não encontrado");
    if (!item.product_id || !item.product) throw new Error("Vincule o item a um produto antes de buscar imagem e dados");

    const product = item.product as any;
    const terms = [
      product.gtin || item.gtin,
      product.manufacturer_code,
      item.supplier_code,
      product.name,
      item.description,
    ].map((value) => String(value ?? "").trim()).filter(Boolean);
    const searchQuery = [...new Set(terms)].join(" ").slice(0, 500);

    const { data: active, error: activeError } = await sb
      .from("product_enrichment_jobs")
      .select("id, search_query")
      .eq("tenant_id", context.tenantId)
      .eq("product_id", item.product_id)
      .in("status", ["queued", "processing", "review"])
      .maybeSingle();
    if (activeError) throw new Error(activeError.message);
    if (active) {
      if (active.search_query !== searchQuery) {
        await sb.from("product_enrichment_jobs")
          .update({ search_query: searchQuery, trigger_source: "nfe", scheduled_at: new Date().toISOString() })
          .eq("id", active.id).eq("tenant_id", context.tenantId);
      }
      return { ok: true, jobId: active.id as string, reused: true, searchQuery };
    }

    const { data: created, error: createError } = await sb
      .from("product_enrichment_jobs")
      .insert({
        tenant_id: context.tenantId,
        product_id: item.product_id,
        trigger_source: "nfe",
        status: "queued",
        search_query: searchQuery,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (createError) {
      if (createError.code === "23505") {
        const { data: concurrent } = await sb.from("product_enrichment_jobs").select("id")
          .eq("tenant_id", context.tenantId).eq("product_id", item.product_id)
          .in("status", ["queued", "processing", "review"]).single();
        if (concurrent) return { ok: true, jobId: concurrent.id as string, reused: true, searchQuery };
      }
      throw new Error(createError.message);
    }
    return { ok: true, jobId: created.id as string, reused: false, searchQuery };
  });
