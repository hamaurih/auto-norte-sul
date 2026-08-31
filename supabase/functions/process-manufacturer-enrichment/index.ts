import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type CatalogSource = {
  id: string;
  name: string;
  base_url: string;
  search_url_template: string | null;
  allowed_domains: string[] | null;
  supported_fields: string[] | null;
  image_usage_note: string | null;
};

type Match = { url: URL; html: string; matchedCode: string };

type JsonLdProduct = {
  name?: string;
  description?: string;
  image?: string | string[] | Array<{ url?: string; contentUrl?: string }>;
  sku?: string;
  mpn?: string;
  gtin?: string;
  gtin8?: string;
  gtin12?: string;
  gtin13?: string;
  gtin14?: string;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const decodeEntities = (value: string) => value
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const text = (html: string) => decodeEntities(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const meta = (html: string, key: string) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"))?.[1]
    ?? null;
  return found ? decodeEntities(found.trim()) : null;
};

const absolute = (href: string, base: string) => {
  try { return new URL(decodeEntities(href), base); } catch { return null; }
};

const privateIp = (ip: string) => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip);

function isAllowedDomain(hostname: string, domains: string[]) {
  const host = hostname.toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function safeHtml(url: URL, domains: string[]) {
  if (url.protocol !== "https:" || !isAllowedDomain(url.hostname, domains)) {
    throw new Error("Domínio fora da lista permitida");
  }

  const ips = [
    ...(await Deno.resolveDns(url.hostname, "A").catch(() => [])),
    ...(await Deno.resolveDns(url.hostname, "AAAA").catch(() => [])),
  ];
  if (!ips.length || ips.some(privateIp)) throw new Error("Destino de rede bloqueado");

  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      "user-agent": "AutoNorteSulCatalog/2.0 (+official manufacturer catalog enrichment)",
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`Fonte respondeu ${response.status}`);

  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("text/html") && !type.toLowerCase().includes("application/xhtml+xml")) {
    throw new Error("Fonte não retornou HTML");
  }

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 2_500_000) throw new Error("Página excede 2,5 MB");

  const html = await response.text();
  if (html.length > 2_500_000) throw new Error("Página excede 2,5 MB");
  return html;
}

function links(html: string, base: string, domains: string[]) {
  const found: Array<{ url: URL; label: string; index: number }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absolute(match[1], base);
    if (!url || url.protocol !== "https:" || !isAllowedDomain(url.hostname, domains)) continue;
    url.hash = "";
    found.push({ url, label: text(match[2]), index: match.index ?? 0 });
  }
  return found;
}

function codeVariants(code: string, brandName: string) {
  const base = normalize(code);
  const variants = new Set<string>();
  if (base) variants.add(base);

  const brand = normalize(brandName);
  if (brand.includes("REFORCEL") && base && !base.startsWith("RE")) variants.add(`RE${base}`);
  return [...variants].filter((value) => value.length >= 3);
}

function fuzzyCodeRegex(normalizedCode: string) {
  const chars = normalizedCode.split("").map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(chars.join("[^A-Za-z0-9]{0,10}"), "i");
}

function detailPath(url: URL) {
  return /\/produto\/|\/produtos\/visualizar\//i.test(url.pathname);
}

function catalogPath(url: URL) {
  return /\/produtos?(?:\/|$)|\/categoria-produto\/|catalog|automotiva|linha-completa|linha\//i.test(url.pathname);
}

function findNearbyDetailLink(html: string, base: string, domains: string[], variants: string[]) {
  const anchors = links(html, base, domains).filter((item) => detailPath(item.url));
  if (!anchors.length) return null;

  let best: { url: URL; distance: number } | null = null;
  for (const variant of variants) {
    const match = fuzzyCodeRegex(variant).exec(html);
    if (!match || match.index == null) continue;
    for (const anchor of anchors) {
      const distance = Math.abs(anchor.index - match.index);
      if (distance > 7000) continue;
      if (!best || distance < best.distance) best = { url: anchor.url, distance };
    }
  }
  return best?.url ?? null;
}

function buildEntryUrl(source: CatalogSource, code: string) {
  const template = source.search_url_template?.trim() || source.base_url;
  const normalizedCode = normalize(code);
  const expanded = template
    .replaceAll("{code}", encodeURIComponent(code))
    .replaceAll("{code_raw}", encodeURIComponent(code))
    .replaceAll("{code_normalized}", encodeURIComponent(normalizedCode));
  return new URL(expanded);
}

async function findOfficialPage(entry: URL, domains: string[], code: string, brandName: string): Promise<Match | null> {
  const variants = codeVariants(code, brandName);
  if (!variants.length) return null;

  const visited = new Set<string>();
  const queued = new Set<string>([entry.href]);
  const queue: URL[] = [entry];

  for (let scanned = 0; queue.length && scanned < 55; scanned++) {
    const current = queue.shift()!;
    queued.delete(current.href);
    if (visited.has(current.href)) continue;
    visited.add(current.href);

    const html = await safeHtml(current, domains);
    const bodyNormalized = normalize(text(html));
    const matchedCode = variants.find((variant) => bodyNormalized.includes(variant));

    if (matchedCode) {
      if (detailPath(current)) return { url: current, html, matchedCode };

      const title = meta(html, "og:title")
        ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?? "";
      if (normalize(text(title)).includes(matchedCode)) return { url: current, html, matchedCode };

      const nearby = findNearbyDetailLink(html, current.href, domains, [matchedCode]);
      if (nearby) {
        const productHtml = await safeHtml(nearby, domains);
        const productBody = normalize(text(productHtml));
        if (productBody.includes(matchedCode)) return { url: nearby, html: productHtml, matchedCode };
      }
    }

    const pageLinks = links(html, current.href, domains);
    const direct = pageLinks.find((item) => variants.some((variant) => normalize(item.label).includes(variant)));
    if (direct) {
      const productHtml = await safeHtml(direct.url, domains);
      const productBody = normalize(text(productHtml));
      const directCode = variants.find((variant) => productBody.includes(variant));
      if (directCode) return { url: direct.url, html: productHtml, matchedCode: directCode };
    }

    // Prioriza páginas de listagem, categoria e paginação. Isso evita abrir centenas
    // de detalhes sem necessidade e permite percorrer catálogos grandes como Brucke/Reforcel.
    const crawlable = pageLinks
      .filter((item) => !detailPath(item.url) && catalogPath(item.url))
      .sort((a, b) => {
        const aPage = /[?&](?:pag|page|paged)=\d+/i.test(a.url.href) ? -1 : 0;
        const bPage = /[?&](?:pag|page|paged)=\d+/i.test(b.url.href) ? -1 : 0;
        return aPage - bPage;
      });

    for (const item of crawlable) {
      if (queue.length >= 90) break;
      if (visited.has(item.url.href) || queued.has(item.url.href)) continue;
      queued.add(item.url.href);
      queue.push(item.url);
    }
  }

  return null;
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const nested = row["@graph"] ? flattenJsonLd(row["@graph"]) : [];
  return [row, ...nested];
}

function jsonLdProduct(html: string): JsonLdProduct | null {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]).trim());
      for (const item of flattenJsonLd(parsed)) {
        const row = item as Record<string, unknown>;
        const type = row["@type"];
        const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
        if (types.some((value) => value.toLowerCase() === "product")) return row as JsonLdProduct;
      }
    } catch {
      // JSON-LD inválido não invalida a fonte; seguimos para metadados HTML.
    }
  }
  return null;
}

function firstJsonLdImage(product: JsonLdProduct | null, base: string) {
  const image = product?.image;
  const candidates: string[] = [];
  if (typeof image === "string") candidates.push(image);
  else if (Array.isArray(image)) {
    for (const item of image) {
      if (typeof item === "string") candidates.push(item);
      else if (item && typeof item === "object") {
        if (typeof item.url === "string") candidates.push(item.url);
        if (typeof item.contentUrl === "string") candidates.push(item.contentUrl);
      }
    }
  }
  for (const candidate of candidates) {
    const url = absolute(candidate, base);
    if (url?.protocol === "https:") return url.href;
  }
  return null;
}

function gtinFromJsonLd(product: JsonLdProduct | null) {
  const value = product?.gtin14 ?? product?.gtin13 ?? product?.gtin12 ?? product?.gtin8 ?? product?.gtin;
  const digits = String(value ?? "").replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : null;
}

function cleanTitle(value: string, brandName: string) {
  let result = text(value).trim();
  result = result.replace(/\s+[|·]\s+.*$/, "").trim();
  const escapedBrand = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  result = result.replace(new RegExp(`\\s+-\\s+${escapedBrand}(?:\\s+-.*)?$`, "i"), "").trim();
  result = result.replace(/\s+-\s+(Acessórios Automotivos|Produtos Eletrônicos).*$/i, "").trim();
  return result;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Método inválido" }, 405);

    const projectUrl = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("authorization");
    if (!auth) return json({ error: "Não autenticado" }, 401);

    const userClient = createClient(projectUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Sessão inválida" }, 401);

    const { limit = 3 } = await req.json().catch(() => ({}));
    const batch = Math.max(1, Math.min(Number(limit) || 3, 5));
    const admin = createClient(projectUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: memberships } = await admin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .in("role", ["owner", "admin", "manager"]);
    const tenantIds = (memberships ?? []).map((value) => value.tenant_id);
    if (!tenantIds.length) return json({ error: "Sem permissão" }, 403);

    const { data: jobs, error } = await admin
      .from("product_enrichment_jobs")
      .select("id,tenant_id,product_id,attempts,product:products(id,name,manufacturer_code,brand_id,brand:brands(id,name))")
      .in("tenant_id", tenantIds)
      .eq("status", "queued")
      .not("product.manufacturer_code", "is", null)
      .order("created_at")
      .limit(batch);
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs ?? []) {
      const product: any = job.product;
      const code = product?.manufacturer_code?.trim();
      const brandName = String(product?.brand?.name ?? "").trim();

      if (!code || !product?.brand_id) {
        results.push({ jobId: job.id, status: "skipped", reason: "Produto sem marca ou código" });
        continue;
      }

      await admin.from("product_enrichment_jobs").update({
        status: "processing",
        started_at: new Date().toISOString(),
        attempts: (job.attempts ?? 0) + 1,
        last_error: null,
      }).eq("id", job.id);

      try {
        const [{ data: sources }, { data: patterns }] = await Promise.all([
          admin.from("manufacturer_catalog_sources")
            .select("id,name,base_url,search_url_template,allowed_domains,supported_fields,image_usage_note")
            .eq("tenant_id", job.tenant_id)
            .eq("brand_id", product.brand_id)
            .eq("status", "active")
            .order("priority", { ascending: false }),
          admin.from("manufacturer_code_patterns")
            .select("code_regex")
            .eq("tenant_id", job.tenant_id)
            .eq("brand_id", product.brand_id)
            .eq("active", true)
            .order("priority", { ascending: false }),
        ]);

        if (patterns?.length && !patterns.some((pattern) => {
          try { return new RegExp(pattern.code_regex, "i").test(code); } catch { return false; }
        })) {
          throw new Error("Código não corresponde ao padrão cadastrado para a marca");
        }

        let matched: Match | null = null;
        let source: CatalogSource | null = null;
        const sourceErrors: string[] = [];

        for (const candidateSource of (sources ?? []) as CatalogSource[]) {
          try {
            const domains = (candidateSource.allowed_domains ?? []).map((value) => value.toLowerCase());
            if (!domains.length) continue;
            const entry = buildEntryUrl(candidateSource, code);
            matched = await findOfficialPage(entry, domains, code, brandName);
            if (matched) {
              source = candidateSource;
              await admin.from("manufacturer_catalog_sources").update({
                last_sync_at: new Date().toISOString(),
                last_verified_at: new Date().toISOString(),
                last_error: null,
              }).eq("id", candidateSource.id).eq("tenant_id", job.tenant_id);
              break;
            }
          } catch (sourceError) {
            const reason = sourceError instanceof Error ? sourceError.message : "Falha na fonte";
            sourceErrors.push(`${candidateSource.name}: ${reason}`);
            await admin.from("manufacturer_catalog_sources").update({
              last_error: reason,
              last_verified_at: new Date().toISOString(),
            }).eq("id", candidateSource.id).eq("tenant_id", job.tenant_id);
          }
        }

        if (!matched || !source) {
          const suffix = sourceErrors.length ? ` (${sourceErrors.slice(0, 2).join("; ")})` : "";
          throw new Error(`Código não localizado nas fontes oficiais cadastradas${suffix}`);
        }

        const pageText = text(matched.html);
        const ldProduct = jsonLdProduct(matched.html);
        const rawTitle = ldProduct?.name
          ?? meta(matched.html, "og:title")
          ?? matched.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
          ?? product.name;
        const title = cleanTitle(String(rawTitle), brandName);
        const description = text(String(
          ldProduct?.description
          ?? meta(matched.html, "description")
          ?? meta(matched.html, "og:description")
          ?? pageText.slice(0, 1600)
        )).slice(0, 4000);
        const imageUrl = firstJsonLdImage(ldProduct, matched.url.href)
          ?? meta(matched.html, "og:image")
          ?? meta(matched.html, "twitter:image");
        const suggestedGtin = gtinFromJsonLd(ldProduct);
        const officialMpn = String(ldProduct?.mpn ?? ldProduct?.sku ?? "").trim() || null;

        const specifications = {
          source_domain: matched.url.hostname,
          source_brand: brandName,
          matched_code: matched.matchedCode,
          requested_manufacturer_code: code,
          official_mpn: officialMpn,
          supported_fields: source.supported_fields ?? [],
        };

        const { error: insertError } = await admin.from("product_enrichment_candidates").insert({
          tenant_id: job.tenant_id,
          job_id: job.id,
          product_id: job.product_id,
          source_type: "manufacturer",
          source_name: source.name,
          source_url: matched.url.href,
          image_url: imageUrl,
          suggested_name: title || product.name,
          suggested_short_description: description.slice(0, 240),
          suggested_description: description,
          suggested_gtin: suggestedGtin,
          suggested_manufacturer_code: code,
          specifications,
          confidence: 99,
          match_reasons: [
            "Código localizado na fonte oficial",
            "Domínio permitido do fabricante",
            "Marca vinculada ao produto",
            ...(officialMpn && normalize(officialMpn).includes(matched.matchedCode) ? ["Código também presente nos dados estruturados"] : []),
          ],
          status: "pending",
          license_name: source.image_usage_note || null,
        });
        if (insertError) throw insertError;

        await admin.from("product_enrichment_jobs").update({
          status: "review",
          finished_at: new Date().toISOString(),
          last_error: null,
        }).eq("id", job.id);

        results.push({
          jobId: job.id,
          status: "review",
          sourceUrl: matched.url.href,
          sourceName: source.name,
          imageFound: Boolean(imageUrl),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Falha inesperada";
        await admin.from("product_enrichment_jobs").update({
          status: "failed",
          last_error: reason,
          finished_at: new Date().toISOString(),
        }).eq("id", job.id);
        results.push({ jobId: job.id, status: "failed", reason });
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
