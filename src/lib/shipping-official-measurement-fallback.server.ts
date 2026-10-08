type EngineResult = {
  jobId: string;
  candidateId?: string;
  status: string;
  reason?: string;
  sourceName?: string;
  sourceUrl?: string;
};

type Source = {
  id: string;
  name: string;
  base_url: string;
  search_url_template: string | null;
  allowed_domains: string[] | null;
};

type Measurement = {
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  basis: "shipping_package" | "product";
  confidence: number;
  evidence: string[];
};

type Bucket = Omit<Measurement, "basis" | "confidence">;

const normalize = (value: string) => value
  .toUpperCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Z0-9]/g, "");

const decode = (value: string) => value
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

const plain = (html: string) => decode(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const textLines = (html: string) => decode(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
  .replace(/<\/(?:p|div|li|h1|h2|h3|h4|h5|h6|section|article|tr|td|th)>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/[ \t]+/g, " ")
  .replace(/\n\s*\n+/g, "\n")
  .split("\n")
  .map((value) => value.trim())
  .filter(Boolean);

function nameCode(name: string, manufacturerCode: string | null) {
  const token = String(name ?? "").trim().split(/\s+/)[0]?.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9./_-]+$/g, "") ?? "";
  const compact = normalize(token);
  const looksLikeCode = (/[A-Za-z]/.test(token) && /\d/.test(token) && compact.length >= 4) || /^\d{6,}$/.test(compact);
  if (!looksLikeCode) return null;
  if (compact === normalize(String(manufacturerCode ?? ""))) return null;
  return token;
}

function variants(code: string, brand: string) {
  const base = normalize(code);
  const result = new Set<string>(base ? [base] : []);
  const normalizedBrand = normalize(brand);
  if (normalizedBrand.includes("SHOCKLIGHT") && base && !/^(MSL|SLL|SL)/.test(base)) {
    result.add(`MSL${base}`);
    result.add(`SLL${base}`);
    result.add(`SL${base}`);
  }
  if (normalizedBrand.includes("REFORCEL") && base && !base.startsWith("RE")) result.add(`RE${base}`);
  return [...result];
}

function allowedHost(hostname: string, domains: string[]) {
  const host = hostname.toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function privateAddress(address: string) {
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|fc|fd|fe80)/i.test(address);
}

async function safeHtml(url: URL, domains: string[], redirects = 0): Promise<string> {
  if (redirects > 3) throw new Error("redirecionamentos excedidos");
  if (url.protocol !== "https:" || !allowedHost(url.hostname, domains)) throw new Error("domínio não permitido");

  const { lookup } = await import("node:dns/promises");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("destino de rede bloqueado");

  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "AutoNorteSulShippingData/2.1 (+official manufacturer sources)",
    },
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("redirecionamento sem destino");
    const redirected = new URL(location, url);
    if (!allowedHost(redirected.hostname, domains)) throw new Error("redirecionamento fora da lista permitida");
    return safeHtml(redirected, domains, redirects + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("conteúdo não HTML");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 2_500_000) throw new Error("página acima de 2,5 MB");
  const html = await response.text();
  if (html.length > 2_500_000) throw new Error("página acima de 2,5 MB");
  return html;
}

function entryUrl(source: Source, code: string) {
  const template = String(source.search_url_template || source.base_url).trim();
  return new URL(template
    .replaceAll("{code}", encodeURIComponent(code))
    .replaceAll("{code_raw}", encodeURIComponent(code))
    .replaceAll("{code_normalized}", encodeURIComponent(normalize(code))));
}

type Anchor = { url: URL; label: string };
function anchors(html: string, base: string, domains: string[]): Anchor[] {
  const result: Anchor[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(decode(match[1]), base); } catch { continue; }
    if (url.protocol !== "https:" || !allowedHost(url.hostname, domains)) continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    result.push({ url, label: plain(match[2]) });
  }
  return result;
}

function crawlable(url: URL) {
  return /produto|products|catalog|busca|search|categoria|linha|page|pag=|friso|calota|lampad|farol|palheta|sensor|camera|câmera/i.test(url.href);
}

function pageHeading(html: string) {
  return plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
}

async function findOfficialPage(source: Source, code: string, brand: string) {
  const domains = (source.allowed_domains ?? []).map((value) => value.toLowerCase());
  if (!domains.length) return null;
  const codeVariants = variants(code, brand);
  const queue: URL[] = [entryUrl(source, code)];
  const seen = new Set<string>();

  for (let scanned = 0; queue.length && scanned < 22; scanned++) {
    const current = queue.shift()!;
    if (seen.has(current.href)) continue;
    seen.add(current.href);
    const html = await safeHtml(current, domains);
    const normalizedBody = normalize(plain(html));
    const matched = codeVariants.find((value) => normalizedBody.includes(value));
    const pageAnchors = anchors(html, current.href, domains);

    const direct = pageAnchors.find((anchor) => codeVariants.some((value) => normalize(anchor.label).includes(value)));
    if (direct && direct.url.href !== current.href) {
      const detail = await safeHtml(direct.url, domains);
      const detailMatched = codeVariants.find((value) => normalize(plain(detail)).includes(value));
      if (detailMatched) return { url: direct.url, html: detail, matchedCode: detailMatched };
    }

    if (matched && codeVariants.some((value) => normalize(pageHeading(html)).includes(value))) {
      return { url: current, html, matchedCode: matched };
    }

    for (const anchor of pageAnchors) {
      if (!crawlable(anchor.url) || seen.has(anchor.url.href) || queue.some((queued) => queued.href === anchor.url.href)) continue;
      queue.push(anchor.url);
      if (queue.length >= 70) break;
    }
  }
  return null;
}

function decimal(raw: unknown) {
  const value = Number(String(raw ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function weightKg(value: number, unit: string) {
  const normalized = normalize(unit);
  const kg = normalized === "G" || normalized === "GR" || normalized.startsWith("GRAMA") ? value / 1000 : value;
  return kg > 0 && kg <= 500 ? Math.round(kg * 1000) / 1000 : null;
}

function lengthCm(value: number, unit: string) {
  const normalized = normalize(unit);
  let cm = value;
  if (normalized === "MM") cm = value / 10;
  else if (normalized === "M") cm = value * 100;
  return cm > 0 && cm <= 1000 ? Math.round(cm * 100) / 100 : null;
}

function packageContext(value: string) {
  return /embalagem|embalado|pacote|caixa|peso\s*bruto|shipping|package/i.test(value);
}

function emptyBucket(): Bucket {
  return { weightKg: null, lengthCm: null, widthCm: null, heightCm: null, evidence: [] };
}

function count(bucket: Bucket) {
  return [bucket.weightKg, bucket.lengthCm, bucket.widthCm, bucket.heightCm].filter((value) => value != null).length;
}

function addEvidence(bucket: Bucket, value: string) {
  if (bucket.evidence.length < 8 && !bucket.evidence.includes(value)) bucket.evidence.push(value.slice(0, 300));
}

function dimensionField(raw: string): "lengthCm" | "widthCm" | "heightCm" | null {
  const value = normalize(raw);
  if (value === "C" || value.startsWith("COMPRIMENTO") || value === "P" || value.startsWith("PROFUNDIDADE")) return "lengthCm";
  if (value === "L" || value.startsWith("LARGURA")) return "widthCm";
  if (value === "A" || value.startsWith("ALTURA")) return "heightCm";
  return null;
}

function extractMeasurements(html: string): Measurement | null {
  const shipping = emptyBucket();
  const product = emptyBucket();

  for (const line of textLines(html)) {
    const target = packageContext(line) ? shipping : product;

    for (const match of line.matchAll(/peso(?:\s+(?:bruto|liquido|líquido|com\s+embalagem|da\s+embalagem|do\s+produto))?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gramas?|quilogramas?)\b/gi)) {
      const value = decimal(match[1]);
      const converted = value == null ? null : weightKg(value, match[2]);
      if (converted != null) { target.weightKg = converted; addEvidence(target, line); }
    }

    for (const match of line.matchAll(/(comprimento|largura|altura|profundidade)(?:\s+(?:da\s+embalagem|do\s+produto))?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/gi)) {
      const field = dimensionField(match[1]);
      const value = decimal(match[2]);
      const converted = value == null ? null : lengthCm(value, match[3]);
      if (field && converted != null) { target[field] = converted; addEvidence(target, line); }
    }

    const triplet = line.match(/(?:dimens(?:oes|ões)|medidas)?[^()]{0,35}\(\s*(c(?:omprimento)?|l(?:argura)?|a(?:ltura)?|p(?:rofundidade)?)\s*[x×]\s*(c(?:omprimento)?|l(?:argura)?|a(?:ltura)?|p(?:rofundidade)?)\s*[x×]\s*(c(?:omprimento)?|l(?:argura)?|a(?:ltura)?|p(?:rofundidade)?)\s*\)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i);
    if (triplet) {
      const labels = [triplet[1], triplet[2], triplet[3]];
      const values = [triplet[4], triplet[5], triplet[6]];
      for (let index = 0; index < 3; index++) {
        const field = dimensionField(labels[index]);
        const value = decimal(values[index]);
        const converted = value == null ? null : lengthCm(value, triplet[7]);
        if (field && converted != null) target[field] = converted;
      }
      addEvidence(target, line);
    }
  }

  const selected = count(shipping) > 0 ? shipping : product;
  const basis = count(shipping) > 0 ? "shipping_package" as const : "product" as const;
  const populated = count(selected);
  if (!populated) return null;
  const confidence = basis === "shipping_package" ? (populated === 4 ? 99 : populated >= 2 ? 97 : 94) : (populated === 4 ? 96 : populated >= 2 ? 93 : 90);
  return { ...selected, basis, confidence };
}

export async function tryOfficialNameCodeMeasurement(admin: any, tenantId: string, result: EngineResult): Promise<EngineResult | null> {
  if (!["requeued", "failed", "skipped"].includes(result.status)) return null;

  const { data: job, error: jobError } = await admin
    .from("product_enrichment_jobs")
    .select("id,status,product_id,search_query,product:products(id,name,manufacturer_code,brand_id,brand:brands(name))")
    .eq("tenant_id", tenantId)
    .eq("id", result.jobId)
    .maybeSingle();
  if (jobError || !job || !String(job.search_query ?? "").startsWith("[shipping]")) return null;

  const product = job.product as { id: string; name: string; manufacturer_code: string | null; brand_id: string | null; brand: { name?: string | null } | null } | null;
  if (!product?.brand_id) return null;
  const code = nameCode(product.name, product.manufacturer_code);
  if (!code) return null;
  const brand = String(product.brand?.name ?? "").trim();

  const { data: sources, error: sourceError } = await admin
    .from("manufacturer_catalog_sources")
    .select("id,name,base_url,search_url_template,allowed_domains")
    .eq("tenant_id", tenantId)
    .eq("brand_id", product.brand_id)
    .eq("status", "active")
    .order("priority", { ascending: false });
  if (sourceError) return null;

  for (const source of (sources ?? []) as Source[]) {
    try {
      const found = await findOfficialPage(source, code, brand);
      if (!found) continue;
      const measurement = extractMeasurements(found.html);
      if (!measurement) continue;

      const { data: candidate, error: candidateError } = await admin
        .from("product_enrichment_candidates")
        .insert({
          tenant_id: tenantId,
          job_id: job.id,
          product_id: job.product_id,
          source_type: "manufacturer",
          source_name: source.name,
          source_url: found.url.href,
          suggested_weight_kg: measurement.weightKg,
          suggested_length_cm: measurement.lengthCm,
          suggested_width_cm: measurement.widthCm,
          suggested_height_cm: measurement.heightCm,
          measurement_basis: measurement.basis,
          measurement_confidence: measurement.confidence,
          confidence: measurement.confidence,
          specifications: {
            source_domain: found.url.hostname,
            source_brand: brand,
            matched_code: found.matchedCode,
            matched_search_code: code,
            original_manufacturer_code: product.manufacturer_code,
            shipping_measurements: {
              weight_kg: measurement.weightKg,
              length_cm: measurement.lengthCm,
              width_cm: measurement.widthCm,
              height_cm: measurement.heightCm,
              basis: measurement.basis,
              confidence: measurement.confidence,
              evidence: measurement.evidence,
            },
          },
          match_reasons: [
            `Código ${code} extraído do nome e localizado na fonte oficial`,
            measurement.basis === "shipping_package" ? "Dados identificados como embalagem/pacote" : "Dados identificados como medidas físicas do produto",
            "Sugestão exige aprovação humana antes de preencher o cadastro",
          ],
          status: "pending",
        })
        .select("id")
        .single();
      if (candidateError || !candidate?.id) continue;

      const { error: updateError } = await admin
        .from("product_enrichment_jobs")
        .update({ status: "review", finished_at: new Date().toISOString(), last_error: null })
        .eq("id", job.id)
        .eq("tenant_id", tenantId);
      if (updateError) {
        await admin.from("product_enrichment_candidates").delete().eq("id", candidate.id).eq("tenant_id", tenantId);
        continue;
      }

      return {
        jobId: result.jobId,
        candidateId: candidate.id,
        status: "review",
        sourceName: source.name,
        sourceUrl: found.url.href,
        reason: `Fonte oficial localizada pelo código ${code} extraído do nome`,
      };
    } catch {
      // Tenta a próxima fonte oficial. A falha não altera o job já reagendado.
    }
  }

  return null;
}
