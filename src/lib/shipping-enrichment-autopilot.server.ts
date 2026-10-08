import { tdb } from "@/integrations/supabase/tenant-db";

const CLAIM_LIMIT = 1;
const ENGINE_TIMEOUT_MS = 235_000;
const UPC_LOOKUP_TIMEOUT_MS = 10_000;
const MAX_TENANTS_PER_TICK = 5;
const OFFICIAL_SUPABASE_URL = "https://pzwjbitjersngordgcsh.supabase.co";
const ADMIN_BRIDGE_URL = `${OFFICIAL_SUPABASE_URL}/functions/v1/server-admin-bridge`;
const UPCITEMDB_LOOKUP_URL = "https://api.upcitemdb.com/prod/trial/lookup";

type EngineResult = {
  jobId: string;
  candidateId?: string;
  status: string;
  reason?: string;
  sourceName?: string;
  sourceUrl?: string;
};

type UpcItem = {
  ean?: string;
  upc?: string;
  gtin?: string;
  title?: string;
  brand?: string;
  model?: string;
  dimension?: string;
  weight?: string;
};

type ParsedMeasurements = {
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  confidence: number;
  rawWeight: string | null;
  rawDimension: string | null;
};

export type ShippingEnrichmentAutopilotResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  tenants: Array<{
    tenantId: string;
    claimed: number;
    processed: number;
    review: number;
    requeued: number;
    failed: number;
    error: string | null;
    details: EngineResult[];
  }>;
};

function bridgeCredential() {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["AUTH_RATE_LIMIT_PEPPER"];
  if (!key || key.length < 32) throw new Error("Credencial server-only da ponte oficial não configurada");
  return key;
}

async function invokeShippingEngine(jobIds: string[]) {
  const key = bridgeCredential();
  const response = await fetch(ADMIN_BRIDGE_URL, {
    method: "POST",
    headers: {
      "x-cutover-key": key,
      "x-proxy-path": "/functions/v1/process-shipping-enrichment",
      "x-proxy-method": "POST",
      "x-forward-content-type": "application/json",
      "x-forward-accept": "application/json",
    },
    body: JSON.stringify({ jobIds }),
    signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; results?: EngineResult[]; error?: string } | null;
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? `Worker de peso/medidas respondeu ${response.status}`);
  return body.results ?? [];
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function sameGtin(a: unknown, b: unknown) {
  const left = digits(a);
  const right = digits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (![8, 12, 13, 14].includes(left.length) || ![8, 12, 13, 14].includes(right.length)) return false;
  return left.padStart(14, "0") === right.padStart(14, "0");
}

function parseDecimal(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function parseWeightKg(raw: string | null | undefined) {
  if (!raw) return null;
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|kgs?|kilograms?|quilogramas?|g|gr|grams?|gramas?|lb|lbs|pounds?|oz|ounces?)\b/i);
  if (!match) return null;
  const value = parseDecimal(match[1]);
  if (value == null) return null;
  const unit = match[2].toLowerCase();
  let kg = value;
  if (/^(g|gr|gram|grams|gramas)$/.test(unit)) kg = value / 1000;
  else if (/^(lb|lbs|pound|pounds)$/.test(unit)) kg = value * 0.45359237;
  else if (/^(oz|ounce|ounces)$/.test(unit)) kg = value * 0.028349523125;
  if (!(kg > 0 && kg <= 500)) return null;
  return round(kg, 3);
}

function dimensionMultiplier(unit: string) {
  const normalized = unit.toLowerCase();
  if (/^(mm|millimeters?|milimetros?|milímetros?)$/.test(normalized)) return 0.1;
  if (/^(cm|centimeters?|centimetros?|centímetros?)$/.test(normalized)) return 1;
  if (/^(m|meters?|metros?)$/.test(normalized)) return 100;
  if (/^(in|inch|inches|polegadas?)$/.test(normalized)) return 2.54;
  if (/^(ft|feet|foot|pes|pés)$/.test(normalized)) return 30.48;
  return null;
}

function parseDimensionCm(raw: string | null | undefined) {
  if (!raw) return null;
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|millimeters?|milimetros?|milímetros?|cm|centimeters?|centimetros?|centímetros?|m|meters?|metros?|in|inch|inches|polegadas?|ft|feet|foot|pes|pés)\b/i);
  if (!match) return null;
  const multiplier = dimensionMultiplier(match[4]);
  const values = [parseDecimal(match[1]), parseDecimal(match[2]), parseDecimal(match[3])];
  if (multiplier == null || values.some((value) => value == null)) return null;
  const converted = values.map((value) => round((value as number) * multiplier, 2));
  if (converted.some((value) => !(value > 0 && value <= 1000))) return null;
  // UPCitemdb devolve uma string de dimensão de produto. Mantemos a ordem
  // publicada como C × L × A apenas como sugestão para revisão humana.
  return { lengthCm: converted[0], widthCm: converted[1], heightCm: converted[2] };
}

function parseUpcMeasurements(item: UpcItem): ParsedMeasurements | null {
  const weightKg = parseWeightKg(item.weight);
  const dimension = parseDimensionCm(item.dimension);
  if (weightKg == null && !dimension) return null;
  const populated = [weightKg, dimension?.lengthCm, dimension?.widthCm, dimension?.heightCm].filter((value) => value != null).length;
  const confidence = populated === 4 ? 88 : populated >= 2 ? 85 : 82;
  return {
    weightKg,
    lengthCm: dimension?.lengthCm ?? null,
    widthCm: dimension?.widthCm ?? null,
    heightCm: dimension?.heightCm ?? null,
    confidence,
    rawWeight: item.weight?.trim() || null,
    rawDimension: item.dimension?.trim() || null,
  };
}

async function lookupUpcItemDb(gtin: string) {
  const url = new URL(UPCITEMDB_LOOKUP_URL);
  url.searchParams.set("upc", gtin);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "AutoNorteSulShippingData/1.0",
    },
    signal: AbortSignal.timeout(UPC_LOOKUP_TIMEOUT_MS),
  });
  if (response.status === 404) return { item: null as UpcItem | null, rateRemaining: response.headers.get("x-ratelimit-remaining") };
  if (response.status === 429) {
    return { item: null as UpcItem | null, rateRemaining: "0", rateLimited: true };
  }
  if (!response.ok) throw new Error(`UPCitemdb respondeu ${response.status}`);
  const body = await response.json().catch(() => null) as { items?: UpcItem[] } | null;
  const item = (body?.items ?? []).find((candidate) =>
    sameGtin(candidate.ean, gtin) || sameGtin(candidate.upc, gtin) || sameGtin(candidate.gtin, gtin)
  ) ?? null;
  return {
    item,
    rateRemaining: response.headers.get("x-ratelimit-remaining"),
    rateLimited: false,
  };
}

async function tryGtinFallback(admin: any, tenantId: string, result: EngineResult): Promise<EngineResult> {
  if (!["requeued", "failed", "skipped"].includes(result.status)) return result;

  const { data: job, error: jobError } = await admin
    .from("product_enrichment_jobs")
    .select("id,status,product_id,search_query,product:products(id,name,sku,gtin,manufacturer_code,brand:brands(name))")
    .eq("tenant_id", tenantId)
    .eq("id", result.jobId)
    .maybeSingle();
  if (jobError || !job) return result;
  if (!String(job.search_query ?? "").startsWith("[shipping]")) return result;

  const product = job.product as {
    id: string;
    name?: string | null;
    sku?: string | null;
    gtin?: string | null;
    manufacturer_code?: string | null;
    brand?: { name?: string | null } | null;
  } | null;
  const gtin = digits(product?.gtin);
  if (![8, 12, 13, 14].includes(gtin.length)) return result;

  let lookup: Awaited<ReturnType<typeof lookupUpcItemDb>>;
  try {
    lookup = await lookupUpcItemDb(gtin);
  } catch (error) {
    return { ...result, reason: `${result.reason ?? "Fonte oficial sem dados"}; fallback GTIN falhou: ${error instanceof Error ? error.message : "erro"}` };
  }
  if (lookup.rateLimited) {
    return { ...result, reason: `${result.reason ?? "Fonte oficial sem dados"}; limite diário/temporário do fallback GTIN atingido` };
  }
  if (!lookup.item) return result;

  const measurement = parseUpcMeasurements(lookup.item);
  if (!measurement) return result;

  const sourceUrl = `https://www.upcitemdb.com/upc/${encodeURIComponent(gtin)}`;
  const evidence = [
    `GTIN/EAN confirmado: ${gtin}`,
    measurement.rawWeight ? `Peso informado pela base: ${measurement.rawWeight}` : null,
    measurement.rawDimension ? `Dimensão de produto informada pela base: ${measurement.rawDimension}` : null,
  ].filter((value): value is string => Boolean(value));

  const { data: candidate, error: candidateError } = await admin
    .from("product_enrichment_candidates")
    .insert({
      tenant_id: tenantId,
      job_id: job.id,
      product_id: job.product_id,
      source_type: "web",
      source_name: "UPCitemdb (GTIN)",
      source_url: sourceUrl,
      suggested_weight_kg: measurement.weightKg,
      suggested_length_cm: measurement.lengthCm,
      suggested_width_cm: measurement.widthCm,
      suggested_height_cm: measurement.heightCm,
      measurement_basis: "product",
      measurement_confidence: measurement.confidence,
      confidence: measurement.confidence,
      specifications: {
        source_domain: "upcitemdb.com",
        lookup_identifier: gtin,
        returned_ean: lookup.item.ean ?? null,
        returned_upc: lookup.item.upc ?? null,
        returned_gtin: lookup.item.gtin ?? null,
        title: lookup.item.title ?? null,
        brand: lookup.item.brand ?? null,
        model: lookup.item.model ?? null,
        shipping_measurements: {
          weight_kg: measurement.weightKg,
          length_cm: measurement.lengthCm,
          width_cm: measurement.widthCm,
          height_cm: measurement.heightCm,
          basis: "product",
          confidence: measurement.confidence,
          raw_weight: measurement.rawWeight,
          raw_dimension: measurement.rawDimension,
          evidence,
        },
        rate_limit_remaining: lookup.rateRemaining ?? null,
      },
      match_reasons: [
        "Correspondência exata por GTIN/EAN em base estruturada",
        "Fonte secundária: exige revisão humana antes de aplicar",
        ...(measurement.rawDimension ? ["Ordem das dimensões preservada como publicada pela fonte"] : []),
      ],
      status: "pending",
    })
    .select("id")
    .single();
  if (candidateError || !candidate?.id) return result;

  const { error: updateError } = await admin
    .from("product_enrichment_jobs")
    .update({ status: "review", finished_at: new Date().toISOString(), last_error: null })
    .eq("id", job.id)
    .eq("tenant_id", tenantId);
  if (updateError) {
    await admin.from("product_enrichment_candidates").delete().eq("id", candidate.id).eq("tenant_id", tenantId);
    return result;
  }

  return {
    jobId: result.jobId,
    candidateId: candidate.id,
    status: "review",
    sourceName: "UPCitemdb (GTIN)",
    sourceUrl,
    reason: "Fonte oficial não confirmou medidas; encontrado dado estruturado por GTIN para revisão manual",
  };
}

export async function runShippingEnrichmentAutopilot(): Promise<ShippingEnrichmentAutopilotResult> {
  const startedAt = new Date().toISOString();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = tdb(supabaseAdmin) as any;

  const { data: queuedRows, error: queuedError } = await admin
    .from("product_enrichment_jobs")
    .select("tenant_id")
    .eq("status", "queued")
    .like("search_query", "[shipping]%")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(100);
  if (queuedError) throw new Error(queuedError.message);

  const tenantIds = [...new Set((queuedRows ?? []).map((row: { tenant_id: string }) => row.tenant_id))]
    .slice(0, MAX_TENANTS_PER_TICK) as string[];
  const tenants: ShippingEnrichmentAutopilotResult["tenants"] = [];

  for (const tenantId of tenantIds) {
    const summary = {
      tenantId,
      claimed: 0,
      processed: 0,
      review: 0,
      requeued: 0,
      failed: 0,
      error: null as string | null,
      details: [] as EngineResult[],
    };
    tenants.push(summary);
    try {
      const { data: claimed, error: claimError } = await admin.rpc("claim_shipping_enrichment_jobs", {
        p_tenant_id: tenantId,
        p_limit: CLAIM_LIMIT,
      });
      if (claimError) throw new Error(claimError.message);
      const jobIds = (claimed ?? []).map((row: { job_id: string }) => row.job_id);
      summary.claimed = jobIds.length;
      if (!jobIds.length) continue;

      const engineResults = await invokeShippingEngine(jobIds);
      const results: EngineResult[] = [];
      for (const engineResult of engineResults) {
        results.push(await tryGtinFallback(admin, tenantId, engineResult));
      }

      summary.processed = results.length;
      summary.details = results.slice(0, 10);
      for (const result of results) {
        if (result.status === "review") summary.review += 1;
        else if (result.status === "requeued") summary.requeued += 1;
        else if (result.status === "failed" || result.status === "skipped") summary.failed += 1;
      }
    } catch (error) {
      summary.error = error instanceof Error ? error.message : "Falha inesperada no worker de peso/medidas";
    }
  }

  return {
    ok: tenants.every((tenant) => !tenant.error),
    startedAt,
    finishedAt: new Date().toISOString(),
    tenants,
  };
}
