import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type Source = {
  id: string;
  name: string;
  base_url: string;
  search_url_template: string | null;
  allowed_domains: string[] | null;
};

type Measurements = {
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  basis: "shipping_package" | "product" | "unknown";
  confidence: number;
  evidence: string[];
};

type Match = { url: URL; html: string; matchedCode: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const decode = (v: string) => v
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
const normalize = (v: string) => v.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
const plain = (html: string) => decode(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const lines = (html: string) => decode(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
  .replace(/<\/(?:p|div|li|h1|h2|h3|h4|h5|h6|section|article|tr|td|th)>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n")
  .split("\n").map((v) => v.trim()).filter(Boolean);
const absolute = (href: string, base: string) => { try { return new URL(decode(href), base); } catch { return null; } };
const privateIp = (ip: string) => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|fc|fd|fe80)/i.test(ip);
const isAllowed = (host: string, domains: string[]) => domains.some((d) => host.toLowerCase() === d || host.toLowerCase().endsWith(`.${d}`));

async function secureEqual(a: string, b: string) {
  if (!a || !b) return false;
  const e = new TextEncoder();
  const [da, db] = await Promise.all([crypto.subtle.digest("SHA-256", e.encode(a)), crypto.subtle.digest("SHA-256", e.encode(b))]);
  const aa = new Uint8Array(da), bb = new Uint8Array(db);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function safeHtml(url: URL, domains: string[], redirects = 0): Promise<string> {
  if (redirects > 3) throw new Error("Fonte excedeu o limite de redirecionamentos");
  if (url.protocol !== "https:" || !isAllowed(url.hostname, domains)) throw new Error("Domínio fora da lista permitida");
  const ips = [
    ...(await Deno.resolveDns(url.hostname, "A").catch(() => [])),
    ...(await Deno.resolveDns(url.hostname, "AAAA").catch(() => [])),
  ];
  if (!ips.length || ips.some(privateIp)) throw new Error("Destino de rede bloqueado");
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(9000),
    headers: { "user-agent": "AutoNorteSulShippingData/1.0 (+official manufacturer sources)", accept: "text/html,application/xhtml+xml" },
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    const next = location ? absolute(location, url.href) : null;
    if (!next || next.protocol !== "https:" || !isAllowed(next.hostname, domains)) throw new Error("Redirecionamento não permitido");
    return safeHtml(next, domains, redirects + 1);
  }
  if (!response.ok) throw new Error(`Fonte respondeu ${response.status}`);
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("Fonte não retornou HTML");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 2_500_000) throw new Error("Página excede 2,5 MB");
  const html = await response.text();
  if (html.length > 2_500_000) throw new Error("Página excede 2,5 MB");
  return html;
}

function codeVariants(code: string, brand: string) {
  const base = normalize(code);
  const out = new Set<string>();
  if (base) out.add(base);
  if (normalize(brand).includes("REFORCEL") && base && !base.startsWith("RE")) out.add(`RE${base}`);
  return [...out].filter((v) => v.length >= 3);
}

function buildEntry(source: Source, code: string) {
  const template = (source.search_url_template || source.base_url).trim();
  return new URL(template
    .replaceAll("{code}", encodeURIComponent(code))
    .replaceAll("{code_raw}", encodeURIComponent(code))
    .replaceAll("{code_normalized}", encodeURIComponent(normalize(code))));
}

function crawlLinks(html: string, base: string, domains: string[]) {
  const out: URL[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    const u = absolute(m[1], base);
    if (!u || u.protocol !== "https:" || !isAllowed(u.hostname, domains)) continue;
    u.hash = "";
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    if (/produto|products|catalog|busca|search|categoria|linha|page|pag=/i.test(u.href)) out.push(u);
  }
  return out;
}

async function findProductPage(source: Source, code: string, brand: string, maxPages = 24): Promise<Match | null> {
  const domains = (source.allowed_domains ?? []).map((v) => v.toLowerCase());
  if (!domains.length) throw new Error("Fonte sem domínios permitidos");
  const variants = codeVariants(code, brand);
  if (!variants.length) return null;
  const queue = [buildEntry(source, code)];
  const seen = new Set<string>();
  for (let scanned = 0; queue.length && scanned < maxPages; scanned++) {
    const current = queue.shift()!;
    if (seen.has(current.href)) continue;
    seen.add(current.href);
    const html = await safeHtml(current, domains);
    const normalized = normalize(plain(html));
    const matchedCode = variants.find((v) => normalized.includes(v));
    if (matchedCode) return { url: current, html, matchedCode };
    for (const link of crawlLinks(html, current.href, domains)) {
      if (!seen.has(link.href) && !queue.some((q) => q.href === link.href)) queue.push(link);
      if (queue.length >= 70) break;
    }
  }
  return null;
}

function num(raw: unknown): number | null {
  const v = Number(String(raw ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : null;
}
function weightKg(value: number, unit: string) {
  const u = normalize(unit);
  const v = u === "G" || u === "GR" || u.startsWith("GRAMA") || u === "GRM" ? value / 1000 : value;
  return v > 0 && v <= 500 ? Math.round(v * 1000) / 1000 : null;
}
function lengthCm(value: number, unit: string) {
  const u = normalize(unit);
  let v = value;
  if (u === "MM" || u === "MMT") v = value / 10;
  else if (u === "M" || u === "MTR") v = value * 100;
  return v > 0 && v <= 1000 ? Math.round(v * 100) / 100 : null;
}
function packageContext(v: string) { return /embalagem|embalado|pacote|caixa|peso\s*bruto|shipping|package/i.test(v); }

type Bucket = { weightKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null; evidence: string[] };
const bucket = (): Bucket => ({ weightKg: null, lengthCm: null, widthCm: null, heightCm: null, evidence: [] });
function fieldCount(v: Bucket) { return [v.weightKg, v.lengthCm, v.widthCm, v.heightCm].filter((x) => x != null).length; }
function putEvidence(b: Bucket, line: string) { if (b.evidence.length < 8 && !b.evidence.includes(line)) b.evidence.push(line.slice(0, 300)); }
function dimField(token: string): "lengthCm" | "widthCm" | "heightCm" | null {
  const t = normalize(token);
  if (t === "C" || t.startsWith("COMPRIMENTO") || t === "P" || t.startsWith("PROFUNDIDADE")) return "lengthCm";
  if (t === "L" || t.startsWith("LARGURA")) return "widthCm";
  if (t === "A" || t.startsWith("ALTURA")) return "heightCm";
  return null;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return [row, ...(row["@graph"] ? flattenJsonLd(row["@graph"]) : [])];
}
function productJsonLd(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decode(m[1]).trim());
      for (const row of flattenJsonLd(parsed)) {
        const rawType = row["@type"];
        const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType ?? "")];
        if (types.some((v) => v.toLowerCase() === "product")) return row;
      }
    } catch { /* visible text fallback */ }
  }
  return null;
}
function quantitative(raw: unknown, kind: "weight" | "length"): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return kind === "weight" ? weightKg(raw, "kg") : lengthCm(raw, "cm");
  if (typeof raw === "string") {
    const m = raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gramas?|quilogramas?|mm|cm|m)\b/i);
    const n = m ? num(m[1]) : null;
    if (!m || n == null) return null;
    return kind === "weight" ? weightKg(n, m[2]) : lengthCm(n, m[2]);
  }
  if (typeof raw === "object") {
    const q = raw as Record<string, unknown>;
    const n = num(q.value ?? q.maxValue ?? q.minValue);
    if (n == null) return null;
    const unit = String(q.unitText ?? q.unitCode ?? (kind === "weight" ? "kg" : "cm"));
    return kind === "weight" ? weightKg(n, unit) : lengthCm(n, unit);
  }
  return null;
}

function extractMeasurements(html: string): Measurements | null {
  const pack = bucket();
  const product = bucket();
  const ld = productJsonLd(html);
  if (ld) {
    product.weightKg = quantitative(ld.weight, "weight");
    product.widthCm = quantitative(ld.width, "length");
    product.heightCm = quantitative(ld.height, "length");
    product.lengthCm = quantitative(ld.depth, "length");
    if (fieldCount(product)) putEvidence(product, "Dados estruturados Product/JSON-LD da página oficial");
  }

  for (const line of lines(html)) {
    const target = packageContext(line) ? pack : product;
    for (const m of line.matchAll(/peso(?:\s+(?:bruto|liquido|líquido|com\s+embalagem|da\s+embalagem|do\s+produto))?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gramas?|quilogramas?)\b/gi)) {
      const n = num(m[1]);
      const converted = n == null ? null : weightKg(n, m[2]);
      if (converted != null && (target.weightKg == null || packageContext(m[0]))) {
        target.weightKg = converted; putEvidence(target, line);
      }
    }
    for (const m of line.matchAll(/(comprimento|largura|altura|profundidade)(?:\s+(?:da\s+embalagem|do\s+produto))?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/gi)) {
      const n = num(m[2]); const field = dimField(m[1]);
      const converted = n == null ? null : lengthCm(n, m[3]);
      if (field && converted != null) { target[field] = converted; putEvidence(target, line); }
    }
    const triplet = line.match(/(?:dimens(?:oes|ões)|medidas)?[^()]{0,35}\(\s*(c(?:omprimento)?|l(?:argura)?|a(?:ltura)?|p(?:rofundidade)?)\s*[x×]\s*(c(?:omprimento)?|l(?:argura)?|a(?:ltura)?|p(?:rofundidade)?)\s*[x×]\s*(c(?:omprimento)?|l(?:argura)?|a(?:ltura)?|p(?:rofundidade)?)\s*\)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i);
    if (triplet) {
      const unit = triplet[7];
      const labels = [triplet[1], triplet[2], triplet[3]];
      const values = [triplet[4], triplet[5], triplet[6]];
      for (let i = 0; i < 3; i++) {
        const field = dimField(labels[i]); const n = num(values[i]); const converted = n == null ? null : lengthCm(n, unit);
        if (field && converted != null) target[field] = converted;
      }
      putEvidence(target, line);
    }
  }

  let chosen: Bucket; let basis: Measurements["basis"];
  if (fieldCount(pack) > 0) { chosen = pack; basis = "shipping_package"; }
  else if (fieldCount(product) > 0) { chosen = product; basis = "product"; }
  else return null;
  const count = fieldCount(chosen);
  const confidence = basis === "shipping_package"
    ? (count === 4 ? 99 : count >= 2 ? 97 : 94)
    : (count === 4 ? 96 : count >= 2 ? 93 : 90);
  return { ...chosen, basis, confidence, evidence: chosen.evidence };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Método inválido" }, 405);
    const projectUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("authorization");
    if (!auth) return json({ error: "Não autenticado" }, 401);
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    const workerMode = await secureEqual(bearer, serviceKey);
    const body = await req.json().catch(() => ({}));
    const admin = createClient(projectUrl, serviceKey);
    let jobs: any[] = [];

    if (workerMode) {
      const jobIds = Array.isArray(body?.jobIds) ? body.jobIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0).slice(0, 5) : [];
      if (!jobIds.length) return json({ error: "Worker exige jobIds previamente reivindicados" }, 400);
      const { data, error } = await admin.from("product_enrichment_jobs")
        .select("id,tenant_id,product_id,attempts,search_query,product:products(id,name,sku,gtin,manufacturer_code,brand_id,weight_kg,length_cm,width_cm,height_cm,brand:brands(id,name))")
        .in("id", jobIds).eq("status", "processing").like("search_query", "[shipping]%");
      if (error) throw error;
      jobs = data ?? [];
    } else {
      const userClient = createClient(projectUrl, anonKey, { global: { headers: { Authorization: auth } } });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return json({ error: "Sessão inválida" }, 401);
      const { data: memberships } = await admin.from("tenant_memberships").select("tenant_id")
        .eq("user_id", user.id).eq("active", true).in("role", ["owner", "admin", "manager"]);
      const tenantIds = (memberships ?? []).map((v: any) => v.tenant_id);
      if (!tenantIds.length) return json({ error: "Sem permissão" }, 403);
      const requestedTenant = typeof body?.tenantId === "string" ? body.tenantId : "";
      const tenantId = requestedTenant && tenantIds.includes(requestedTenant) ? requestedTenant : tenantIds[0];
      const batch = Math.max(1, Math.min(Number(body?.limit ?? 3) || 3, 5));
      const { data: claimed, error: claimError } = await admin.rpc("claim_shipping_enrichment_jobs", { p_tenant_id: tenantId, p_limit: batch });
      if (claimError) throw claimError;
      const ids = (claimed ?? []).map((v: any) => v.job_id);
      if (ids.length) {
        const { data, error } = await admin.from("product_enrichment_jobs")
          .select("id,tenant_id,product_id,attempts,search_query,product:products(id,name,sku,gtin,manufacturer_code,brand_id,weight_kg,length_cm,width_cm,height_cm,brand:brands(id,name))")
          .in("id", ids).eq("status", "processing");
        if (error) throw error;
        jobs = data ?? [];
      }
    }

    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs) {
      const p: any = job.product;
      const code = String(p?.manufacturer_code ?? "").trim();
      const brand = String(p?.brand?.name ?? "").trim();
      if (!code || !p?.brand_id) {
        await admin.from("product_enrichment_jobs").update({ status: "failed", finished_at: new Date().toISOString(), last_error: "Produto sem marca ou código do fabricante" }).eq("id", job.id);
        results.push({ jobId: job.id, status: "failed", reason: "Produto sem marca ou código" });
        continue;
      }
      try {
        const { data: sources, error: sourceError } = await admin.from("manufacturer_catalog_sources")
          .select("id,name,base_url,search_url_template,allowed_domains")
          .eq("tenant_id", job.tenant_id).eq("brand_id", p.brand_id).eq("status", "active").order("priority", { ascending: false });
        if (sourceError) throw sourceError;
        let found: Match | null = null; let source: Source | null = null; const errors: string[] = [];
        for (const s of (sources ?? []) as Source[]) {
          try {
            found = await findProductPage(s, code, brand, workerMode ? 18 : 30);
            if (found) { source = s; break; }
          } catch (error) { errors.push(`${s.name}: ${error instanceof Error ? error.message : "falha"}`); }
        }
        if (!found || !source) throw new Error(`Código não localizado em fonte oficial${errors.length ? ` (${errors.slice(0, 2).join("; ")})` : ""}`);
        const measurement = extractMeasurements(found.html);
        if (!measurement || !fieldCount({ weightKg: measurement.weightKg, lengthCm: measurement.lengthCm, widthCm: measurement.widthCm, heightCm: measurement.heightCm, evidence: [] })) {
          throw new Error("Página oficial localizada, mas peso/medidas não foram encontrados com segurança");
        }
        const specifications = {
          source_domain: found.url.hostname,
          source_brand: brand,
          matched_code: found.matchedCode,
          requested_manufacturer_code: code,
          shipping_measurements: {
            weight_kg: measurement.weightKg,
            length_cm: measurement.lengthCm,
            width_cm: measurement.widthCm,
            height_cm: measurement.heightCm,
            basis: measurement.basis,
            confidence: measurement.confidence,
            evidence: measurement.evidence,
          },
        };
        const reasons = [
          "Código do fabricante localizado em fonte oficial",
          measurement.basis === "shipping_package" ? "Medidas identificadas como embalagem/pacote" : "Medidas identificadas como dados físicos do produto",
          `${fieldCount({ weightKg: measurement.weightKg, lengthCm: measurement.lengthCm, widthCm: measurement.widthCm, heightCm: measurement.heightCm, evidence: [] })} campo(s) de frete encontrado(s)`,
        ];
        const { data: candidate, error: candidateError } = await admin.from("product_enrichment_candidates").insert({
          tenant_id: job.tenant_id,
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
          specifications,
          confidence: measurement.confidence,
          match_reasons: reasons,
          status: "pending",
        }).select("id").single();
        if (candidateError || !candidate) throw candidateError ?? new Error("Não foi possível criar sugestão");
        await admin.from("product_enrichment_jobs").update({ status: "review", finished_at: new Date().toISOString(), last_error: null }).eq("id", job.id).eq("tenant_id", job.tenant_id);
        results.push({ jobId: job.id, candidateId: candidate.id, status: "review", sourceName: source.name, sourceUrl: found.url.href, measurements: measurement });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Falha inesperada";
        const attempts = Number(job.attempts ?? 0);
        if (workerMode && attempts < 3) {
          const delay = attempts <= 1 ? 30 : 180;
          await admin.from("product_enrichment_jobs").update({ status: "queued", started_at: null, finished_at: null, scheduled_at: new Date(Date.now() + delay * 60000).toISOString(), last_error: reason }).eq("id", job.id).eq("tenant_id", job.tenant_id).eq("status", "processing");
          results.push({ jobId: job.id, status: "requeued", reason });
        } else {
          await admin.from("product_enrichment_jobs").update({ status: "failed", finished_at: new Date().toISOString(), last_error: reason }).eq("id", job.id).eq("tenant_id", job.tenant_id);
          results.push({ jobId: job.id, status: "failed", reason });
        }
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
