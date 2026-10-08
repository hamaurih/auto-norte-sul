import { getBlingCredentials } from "./bling.functions";

type EngineResult = {
  jobId: string;
  candidateId?: string;
  status: string;
  reason?: string;
  sourceName?: string;
  sourceUrl?: string;
};

type Measurements = {
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  confidence: number;
  evidence: string[];
};

const BLING_API = "https://api.bling.com.br/Api/v3";
const TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampWeight(value: number | null) {
  return value != null && value > 0 && value <= 500 ? Math.round(value * 1000) / 1000 : null;
}

function clampLength(value: number | null) {
  return value != null && value > 0 && value <= 1000 ? Math.round(value * 100) / 100 : null;
}

function firstNumber(object: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (!(key in object)) continue;
    const value = numberValue(object[key]);
    if (value != null) return { key, value };
  }
  return null;
}

function collectObjects(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectObjects(item, depth + 1));
  if (typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return [row, ...Object.values(row).flatMap((item) => collectObjects(item, depth + 1))];
}

function extractMeasurements(payload: unknown): Measurements | null {
  const rows = collectObjects(payload);
  let weightKg: number | null = null;
  let lengthCm: number | null = null;
  let widthCm: number | null = null;
  let heightCm: number | null = null;
  const evidence: string[] = [];

  for (const row of rows) {
    if (weightKg == null) {
      const gross = firstNumber(row, ["pesoBruto", "peso_bruto", "grossWeight", "peso"]);
      const net = gross ?? firstNumber(row, ["pesoLiquido", "peso_liquido", "netWeight"]);
      if (net) {
        weightKg = clampWeight(net.value);
        if (weightKg != null) evidence.push(`Bling: ${net.key}=${net.value}`);
      }
    }

    const unitRaw = String(row.unidadeMedida ?? row.unidade ?? row.unit ?? "cm").toLowerCase();
    const factor = unitRaw.includes("mm") ? 0.1 : unitRaw === "m" || unitRaw.includes("metro") ? 100 : 1;

    if (widthCm == null) {
      const found = firstNumber(row, ["largura", "width"]);
      if (found) {
        widthCm = clampLength(found.value * factor);
        if (widthCm != null) evidence.push(`Bling: ${found.key}=${found.value} ${unitRaw}`);
      }
    }
    if (heightCm == null) {
      const found = firstNumber(row, ["altura", "height"]);
      if (found) {
        heightCm = clampLength(found.value * factor);
        if (heightCm != null) evidence.push(`Bling: ${found.key}=${found.value} ${unitRaw}`);
      }
    }
    if (lengthCm == null) {
      const found = firstNumber(row, ["profundidade", "comprimento", "depth", "length"]);
      if (found) {
        lengthCm = clampLength(found.value * factor);
        if (lengthCm != null) evidence.push(`Bling: ${found.key}=${found.value} ${unitRaw}`);
      }
    }
  }

  const fields = [weightKg, lengthCm, widthCm, heightCm].filter((value) => value != null).length;
  if (!fields) return null;
  return {
    weightKg,
    lengthCm,
    widthCm,
    heightCm,
    confidence: fields === 4 ? 99 : fields >= 2 ? 97 : 94,
    evidence: evidence.slice(0, 8),
  };
}

async function safeDiagnostic(admin: any, tenantId: string, jobId: string, previous: string | undefined, diagnostic: string) {
  const prefix = String(previous ?? "").trim();
  const lastError = (prefix ? `${prefix} | ${diagnostic}` : diagnostic).slice(0, 900);
  await admin
    .from("product_enrichment_jobs")
    .update({ last_error: lastError })
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .in("status", ["queued", "processing", "failed"]);
}

async function refreshToken(admin: any, tenantId: string) {
  const { data: cfg, error } = await admin
    .from("bling_config")
    .select("id,tenant_id,access_token,refresh_token,expires_at,client_id,client_secret_encrypted")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !cfg?.access_token) return null;

  const expiresAt = cfg.expires_at ? new Date(cfg.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return String(cfg.access_token);
  if (!cfg.refresh_token) return null;

  const credentials = await getBlingCredentials(admin, tenantId, cfg);
  if (!credentials.clientId || !credentials.clientSecret) return null;
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, "utf8").toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
      accept: "1.0",
      "enable-jwt": "1",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(cfg.refresh_token) }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number } | null;
  if (!response.ok || !body?.access_token) return null;

  const expires = new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString();
  await admin.from("bling_config").update({
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? cfg.refresh_token,
    expires_at: expires,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", cfg.id);
  return body.access_token;
}

async function getProduct(token: string, blingId: string) {
  const wait = 450 - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const response = await fetch(`${BLING_API}/produtos/${encodeURIComponent(blingId)}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json", "enable-jwt": "1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as any;
  return body?.data ?? body;
}

export async function tryBlingShippingMeasurement(admin: any, tenantId: string, result: EngineResult): Promise<EngineResult | null> {
  if (!["requeued", "failed", "skipped"].includes(result.status)) return null;
  const { data: job, error: jobError } = await admin
    .from("product_enrichment_jobs")
    .select("id,status,product_id,search_query,product:products(id,name,bling_id,weight_kg,length_cm,width_cm,height_cm)")
    .eq("tenant_id", tenantId)
    .eq("id", result.jobId)
    .maybeSingle();
  if (jobError || !job || !String(job.search_query ?? "").startsWith("[shipping]")) return null;

  const product = job.product as {
    id: string;
    name?: string | null;
    bling_id?: string | null;
    weight_kg?: number | null;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
  } | null;
  const blingId = String(product?.bling_id ?? "").trim();
  if (!blingId) {
    await safeDiagnostic(admin, tenantId, job.id, result.reason, "Bling: produto sem ID de origem");
    return null;
  }

  let token: string | null = null;
  try { token = await refreshToken(admin, tenantId); } catch { token = null; }
  if (!token) {
    await safeDiagnostic(admin, tenantId, job.id, result.reason, "Bling: integração indisponível para consulta");
    return null;
  }

  let original: unknown;
  try { original = await getProduct(token, blingId); } catch { original = null; }
  if (!original) {
    await safeDiagnostic(admin, tenantId, job.id, result.reason, "Bling: cadastro original não pôde ser consultado");
    return null;
  }
  const measurement = extractMeasurements(original);
  if (!measurement) {
    await safeDiagnostic(admin, tenantId, job.id, result.reason, "Bling: cadastro original consultado, sem peso/medidas detectáveis");
    return null;
  }

  const suggestedWeight = product?.weight_kg && Number(product.weight_kg) > 0 ? null : measurement.weightKg;
  const suggestedLength = product?.length_cm && Number(product.length_cm) > 0 ? null : measurement.lengthCm;
  const suggestedWidth = product?.width_cm && Number(product.width_cm) > 0 ? null : measurement.widthCm;
  const suggestedHeight = product?.height_cm && Number(product.height_cm) > 0 ? null : measurement.heightCm;
  if (![suggestedWeight, suggestedLength, suggestedWidth, suggestedHeight].some((value) => value != null)) {
    await safeDiagnostic(admin, tenantId, job.id, result.reason, "Bling: medidas já preenchidas no cadastro atual");
    return null;
  }

  const { data: candidate, error: candidateError } = await admin
    .from("product_enrichment_candidates")
    .insert({
      tenant_id: tenantId,
      job_id: job.id,
      product_id: job.product_id,
      source_type: "bling",
      source_name: "Bling — cadastro original",
      source_url: "https://www.bling.com.br/",
      suggested_weight_kg: suggestedWeight,
      suggested_length_cm: suggestedLength,
      suggested_width_cm: suggestedWidth,
      suggested_height_cm: suggestedHeight,
      measurement_basis: "product",
      measurement_confidence: measurement.confidence,
      confidence: measurement.confidence,
      specifications: {
        bling_id: blingId,
        shipping_measurements: {
          weight_kg: measurement.weightKg,
          length_cm: measurement.lengthCm,
          width_cm: measurement.widthCm,
          height_cm: measurement.heightCm,
          basis: "product",
          confidence: measurement.confidence,
          evidence: measurement.evidence,
        },
      },
      match_reasons: [
        `Cadastro original do mesmo produto no Bling (ID ${blingId})`,
        "Recuperação de dados legados do ERP de origem",
        "Sugestão exige revisão humana antes de preencher campos vazios",
      ],
      status: "pending",
    })
    .select("id")
    .single();
  if (candidateError || !candidate?.id) {
    await safeDiagnostic(admin, tenantId, job.id, result.reason, "Bling: medidas encontradas, mas a sugestão não pôde ser criada");
    return null;
  }

  const { error: updateError } = await admin
    .from("product_enrichment_jobs")
    .update({ status: "review", finished_at: new Date().toISOString(), last_error: null })
    .eq("tenant_id", tenantId)
    .eq("id", job.id);
  if (updateError) {
    await admin.from("product_enrichment_candidates").delete().eq("tenant_id", tenantId).eq("id", candidate.id);
    return null;
  }

  return {
    jobId: result.jobId,
    candidateId: candidate.id,
    status: "review",
    sourceName: "Bling — cadastro original",
    sourceUrl: "https://www.bling.com.br/",
    reason: "Peso/medidas recuperados do cadastro original do produto no Bling",
  };
}
