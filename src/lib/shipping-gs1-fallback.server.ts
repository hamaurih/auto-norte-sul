type EngineResult = {
  jobId: string;
  candidateId?: string;
  status: string;
  reason?: string;
  sourceName?: string;
  sourceUrl?: string;
};

type Quantity = {
  value?: number | string | null;
  measurementUnitCode?: string | null;
};

type TradeItemNode = {
  tradeItemWeight?: {
    grossWeight?: Quantity | null;
    netWeight?: Quantity | null;
  } | null;
  tradeItemMeasurements?: {
    height?: Quantity | null;
    width?: Quantity | null;
    depth?: Quantity | null;
  } | null;
};

type Measurement = {
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  confidence: number;
  evidence: string[];
};

const GS1_TOKEN_URL = "https://api.gs1br.org/oauth/access-token";
const GS1_PROVIDER_URL = "https://api.gs1br.org/provider/v2/verified";
const REQUEST_TIMEOUT_MS = 12_000;

let tokenCache: { value: string; expiresAt: number } | null = null;

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function decimal(value: unknown) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function round(value: number, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function weightKg(quantity?: Quantity | null) {
  if (!quantity) return null;
  const value = decimal(quantity.value);
  if (value == null) return null;
  const unit = String(quantity.measurementUnitCode ?? "KGM").toUpperCase();
  let kg = value;
  if (["GRM", "G", "GR"].includes(unit)) kg = value / 1000;
  else if (["LBR", "LB"].includes(unit)) kg = value * 0.45359237;
  else if (["ONZ", "OZ"].includes(unit)) kg = value * 0.028349523125;
  if (!(kg > 0 && kg <= 500)) return null;
  return round(kg, 3);
}

function lengthCm(quantity?: Quantity | null) {
  if (!quantity) return null;
  const value = decimal(quantity.value);
  if (value == null) return null;
  const unit = String(quantity.measurementUnitCode ?? "CMT").toUpperCase();
  let cm = value;
  if (["MMT", "MM"].includes(unit)) cm = value / 10;
  else if (["MTR", "M"].includes(unit)) cm = value * 100;
  else if (["INH", "IN"].includes(unit)) cm = value * 2.54;
  else if (["FOT", "FT"].includes(unit)) cm = value * 30.48;
  if (!(cm > 0 && cm <= 1000)) return null;
  return round(cm, 2);
}

function findTradeItemNode(value: unknown, depth = 0): TradeItemNode | null {
  if (depth > 8 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTradeItemNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.tradeItemWeight || row.tradeItemMeasurements) return row as TradeItemNode;
  for (const child of Object.values(row)) {
    const found = findTradeItemNode(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseMeasurement(body: unknown): Measurement | null {
  const node = findTradeItemNode(body);
  if (!node) return null;
  const grossWeight = weightKg(node.tradeItemWeight?.grossWeight);
  const netWeight = weightKg(node.tradeItemWeight?.netWeight);
  const measurement: Measurement = {
    weightKg: grossWeight ?? netWeight,
    lengthCm: lengthCm(node.tradeItemMeasurements?.depth),
    widthCm: lengthCm(node.tradeItemMeasurements?.width),
    heightCm: lengthCm(node.tradeItemMeasurements?.height),
    confidence: 0,
    evidence: [],
  };
  const populated = [measurement.weightKg, measurement.lengthCm, measurement.widthCm, measurement.heightCm]
    .filter((item) => item != null).length;
  if (!populated) return null;
  measurement.confidence = populated === 4 ? 99 : populated >= 2 ? 97 : 95;
  if (grossWeight != null) measurement.evidence.push("Peso bruto informado pelo Verified by GS1");
  else if (netWeight != null) measurement.evidence.push("Peso líquido informado pelo Verified by GS1");
  if (measurement.heightCm != null) measurement.evidence.push("Altura informada pelo Verified by GS1");
  if (measurement.widthCm != null) measurement.evidence.push("Largura informada pelo Verified by GS1");
  if (measurement.lengthCm != null) measurement.evidence.push("Profundidade informada pelo Verified by GS1");
  return measurement;
}

function credentials() {
  const clientId = process.env["GS1_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GS1_CLIENT_SECRET"]?.trim();
  const username = process.env["GS1_USERNAME"]?.trim();
  const password = process.env["GS1_PASSWORD"]?.trim();
  if (!clientId || !clientSecret || !username || !password) return null;
  return { clientId, clientSecret, username, password };
}

export function isGs1Configured() {
  return Boolean(credentials());
}

async function accessToken() {
  const config = credentials();
  if (!config) return null;
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;

  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
  const response = await fetch(GS1_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/json",
      accept: "application/json",
      client_id: config.clientId,
    },
    body: JSON.stringify({
      grant_type: "password",
      username: config.username,
      password: config.password,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GS1 token respondeu ${response.status}`);
  const body = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) throw new Error("GS1 não retornou access_token");
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(300, Number(body.expires_in ?? 10800)) * 1000,
  };
  return tokenCache.value;
}

async function lookup(gtin: string) {
  const config = credentials();
  if (!config) return null;
  const token = await accessToken();
  if (!token) return null;
  const url = new URL(GS1_PROVIDER_URL);
  url.searchParams.set("gtin", gtin);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      client_id: config.clientId,
      access_token: token,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Verified by GS1 respondeu ${response.status}`);
  return response.json().catch(() => null);
}

export async function tryGs1ShippingMeasurement(admin: any, tenantId: string, result: EngineResult): Promise<EngineResult | null> {
  if (!isGs1Configured()) return null;
  if (!["requeued", "failed", "skipped"].includes(result.status)) return null;

  const { data: job, error: jobError } = await admin
    .from("product_enrichment_jobs")
    .select("id,status,product_id,search_query,product:products(id,name,gtin,brand:brands(name))")
    .eq("tenant_id", tenantId)
    .eq("id", result.jobId)
    .maybeSingle();
  if (jobError || !job || !String(job.search_query ?? "").startsWith("[shipping]")) return null;

  const product = job.product as { id: string; name?: string | null; gtin?: string | null; brand?: { name?: string | null } | null } | null;
  const gtin = digits(product?.gtin);
  if (![8, 12, 13, 14].includes(gtin.length)) return null;

  let body: unknown;
  try {
    body = await lookup(gtin);
  } catch {
    return null;
  }
  if (!body) return null;
  const measurement = parseMeasurement(body);
  if (!measurement) return null;

  const sourceUrl = `https://verifiedbygs1.gs1br.org/`;
  const { data: candidate, error: candidateError } = await admin
    .from("product_enrichment_candidates")
    .insert({
      tenant_id: tenantId,
      job_id: job.id,
      product_id: job.product_id,
      source_type: "gs1",
      source_name: "Verified by GS1 Brasil",
      source_url: sourceUrl,
      suggested_weight_kg: measurement.weightKg,
      suggested_length_cm: measurement.lengthCm,
      suggested_width_cm: measurement.widthCm,
      suggested_height_cm: measurement.heightCm,
      measurement_basis: "product",
      measurement_confidence: measurement.confidence,
      confidence: measurement.confidence,
      specifications: {
        lookup_identifier: gtin,
        source_domain: "api.gs1br.org",
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
        `GTIN ${gtin} consultado diretamente no Verified by GS1`,
        "Dados cadastrados/validados na infraestrutura GS1",
        "Sugestão exige revisão humana antes de preencher o cadastro",
      ],
      status: "pending",
    })
    .select("id")
    .single();
  if (candidateError || !candidate?.id) return null;

  const { error: updateError } = await admin
    .from("product_enrichment_jobs")
    .update({ status: "review", finished_at: new Date().toISOString(), last_error: null })
    .eq("id", job.id)
    .eq("tenant_id", tenantId);
  if (updateError) {
    await admin.from("product_enrichment_candidates").delete().eq("id", candidate.id).eq("tenant_id", tenantId);
    return null;
  }

  return {
    jobId: result.jobId,
    candidateId: candidate.id,
    status: "review",
    sourceName: "Verified by GS1 Brasil",
    sourceUrl,
    reason: "Peso/medidas localizados pelo GTIN no Verified by GS1 para revisão manual",
  };
}
