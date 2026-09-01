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

type GalleryImage = { sourceUrl: string; alt: string | null; sortOrder: number; isPrimary: boolean };
type VehicleApplication = {
  vehicleMake: string;
  vehicleModel: string;
  yearFrom: number;
  yearTo: number;
  sourceText: string;
  confidence: number;
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

const normalize = (value: string) => value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");

const text = (html: string) => decodeEntities(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const textLines = (html: string) => decodeEntities(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
  .replace(/<\/(?:p|div|li|h1|h2|h3|h4|h5|h6|section|article|tr)>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/[ \t]+/g, " ")
  .replace(/\n\s*\n+/g, "\n")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const meta = (html: string, key: string) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"))?.[1]
    ?? null;
  return found ? decodeEntities(found.trim()) : null;
};

const attr = (tag: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`\\s${escaped}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? null;
};

const absolute = (href: string, base: string) => {
  try { return new URL(decodeEntities(href), base); } catch { return null; }
};

const privateIp = (ip: string) => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip);

function isAllowedDomain(hostname: string, domains: string[]) {
  const host = hostname.toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function safeHtml(url: URL, domains: string[], redirects = 0) {
  if (redirects > 3) throw new Error("Fonte excedeu o limite de redirecionamentos");
  if (url.protocol !== "https:" || !isAllowedDomain(url.hostname, domains)) throw new Error("Domínio fora da lista permitida");
  const ips = [
    ...(await Deno.resolveDns(url.hostname, "A").catch(() => [])),
    ...(await Deno.resolveDns(url.hostname, "AAAA").catch(() => [])),
  ];
  if (!ips.length || ips.some(privateIp)) throw new Error("Destino de rede bloqueado");

  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: {
      "user-agent": "AutoNorteSulCatalog/3.0 (+official gallery and fitment enrichment)",
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Fonte redirecionou sem informar destino");
    const redirected = absolute(location, url.href);
    if (!redirected || redirected.protocol !== "https:" || !isAllowedDomain(redirected.hostname, domains)) {
      throw new Error("Redirecionamento para domínio não permitido");
    }
    return safeHtml(redirected, domains, redirects + 1);
  }
  if (!response.ok) throw new Error(`Fonte respondeu ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("text/html") && !type.toLowerCase().includes("application/xhtml+xml")) throw new Error("Fonte não retornou HTML");
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
  return /\/produto\/|\/produtos\/visualizar\/|\/[^/?]+\/p\/?$/i.test(url.pathname);
}

function catalogPath(url: URL) {
  return /\/produtos?(?:\/|$)|\/categoria-produto\/|catalog|automotiva|linha-completa|linha\//i.test(url.pathname);
}

function inlineCatalogFragment(html: string, variants: string[]) {
  for (const match of html.matchAll(/<a\\b[^>]*>[\\s\\S]*?<\\/a>/gi)) {
    const fragment = match[0];
    if (!/<img\\b/i.test(fragment)) continue;
    const normalized = normalize(text(fragment));
    const matchedCode = variants.find((variant) => normalized.includes(variant));
    if (matchedCode) return { html: fragment, matchedCode };
  }
  return null;
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
  return new URL(template
    .replaceAll("{code}", encodeURIComponent(code))
    .replaceAll("{code_raw}", encodeURIComponent(code))
    .replaceAll("{code_normalized}", encodeURIComponent(normalizedCode)));
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
      const inline = inlineCatalogFragment(html, [matchedCode]);
      if (inline) return { url: current, html: inline.html, matchedCode: inline.matchedCode };
      const title = meta(html, "og:title") ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
      if (normalize(text(title)).includes(matchedCode)) return { url: current, html, matchedCode };
      const nearby = findNearbyDetailLink(html, current.href, domains, [matchedCode]);
      if (nearby) {
        const productHtml = await safeHtml(nearby, domains);
        if (normalize(text(productHtml)).includes(matchedCode)) return { url: nearby, html: productHtml, matchedCode };
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

    const crawlable = pageLinks
      .filter((item) => !detailPath(item.url) && catalogPath(item.url))
      .sort((a, b) => Number(/[?&](?:pag|page|paged)=\d+/i.test(b.url.href)) - Number(/[?&](?:pag|page|paged)=\d+/i.test(a.url.href)));
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
      // Segue para metadados HTML quando JSON-LD estiver malformado.
    }
  }
  return null;
}

function jsonLdImages(product: JsonLdProduct | null, base: string) {
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
  return candidates.map((candidate) => absolute(candidate, base)?.href).filter((value): value is string => Boolean(value?.startsWith("https://")));
}

function productRegion(html: string) {
  const markers = ["Você também pode gostar", "Produtos relacionados", "Related products", "Você pode gostar"];
  let end = html.length;
  const lower = html.toLowerCase();
  for (const marker of markers) {
    const index = lower.indexOf(marker.toLowerCase());
    if (index > 0) end = Math.min(end, index);
  }
  return html.slice(0, end);
}

function imageCanonicalKey(url: string) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)/i, "");
    return parsed.href.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function acceptableProductImage(url: string) {
  const lower = url.toLowerCase();
  if (!lower.startsWith("https://")) return false;
  if (/(logo|favicon|icon|sprite|avatar|flagcdn|bandeira|payment|pagamento|whatsapp|instagram|facebook|youtube|loading|placeholder|cookie|lgpd|selo)/i.test(lower)) return false;
  return /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(lower) || /(uploads|produto|products|media|images|fotos)/i.test(lower);
}

function extractGallery(html: string, base: string, product: JsonLdProduct | null, title: string): GalleryImage[] {
  const candidates: Array<{ url: string; alt: string | null; score: number; order: number }> = [];
  let order = 0;
  const add = (value: string | null | undefined, alt: string | null, score: number) => {
    if (!value) return;
    const url = absolute(value, base);
    if (!url || !acceptableProductImage(url.href)) return;
    candidates.push({ url: url.href, alt, score, order: order++ });
  };

  for (const url of jsonLdImages(product, base)) add(url, title, 120);
  add(meta(html, "og:image"), title, 115);
  add(meta(html, "twitter:image"), title, 110);

  const region = productRegion(html);
  for (const match of region.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const context = region.slice(Math.max(0, (match.index ?? 0) - 300), Math.min(region.length, (match.index ?? 0) + match[0].length + 300));
    if (!/(gallery|galeria|product|produto|zoom|swiper|slide|foto|image)/i.test(context)) continue;
    add(match[1], title, 100);
  }

  for (const match of region.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const context = region.slice(Math.max(0, (match.index ?? 0) - 350), Math.min(region.length, (match.index ?? 0) + tag.length + 350));
    if (!/(gallery|galeria|product|produto|woocommerce|zoom|swiper|slide|foto|image)/i.test(context)) continue;
    const alt = attr(tag, "alt")?.trim() || title;
    for (const name of ["data-large_image", "data-zoom-image", "data-src", "data-lazy-src", "src"]) add(attr(tag, name), alt, 90);
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
    if (srcset) {
      const last = srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).at(-1);
      add(last, alt, 95);
    }
  }

  const byKey = new Map<string, { url: string; alt: string | null; score: number; order: number }>();
  for (const candidate of candidates) {
    const key = imageCanonicalKey(candidate.url);
    const current = byKey.get(key);
    if (!current || candidate.score > current.score) byKey.set(key, candidate);
  }

  return [...byKey.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 12)
    .map((candidate, index) => ({
      sourceUrl: candidate.url,
      alt: candidate.alt,
      sortOrder: index,
      isPrimary: index === 0,
    }));
}

function gtinFromPage(product: JsonLdProduct | null, pageText: string) {
  const structured = product?.gtin14 ?? product?.gtin13 ?? product?.gtin12 ?? product?.gtin8 ?? product?.gtin;
  let digits = String(structured ?? "").replace(/\D/g, "");
  if ([8, 12, 13, 14].includes(digits.length)) return digits;
  digits = pageText.match(/c[oó]digo\s*ean\s*[:\-]?\s*(\d{8,14})/i)?.[1] ?? "";
  return [8, 12, 13, 14].includes(digits.length) ? digits : null;
}

const MAKE_ALIASES = [
  "Mercedes-Benz", "Dodge Ram", "Land Rover", "Range Rover", "Caoa Chery",
  "Volkswagen", "Chevrolet", "Mitsubishi", "Hyundai", "Citroen", "Citroën", "Peugeot",
  "Renault", "Toyota", "Nissan", "Honda", "Ford", "Fiat", "Jeep", "Audi", "BMW", "BYD",
  "Porsche", "Porshe", "Kia", "Chery", "Suzuki", "Subaru", "Volvo", "JAC", "GWM", "Haval",
  "Troller", "RAM", "VW", "GM",
];
const MAKE_PATTERN = MAKE_ALIASES
  .sort((a, b) => b.length - a.length)
  .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

function canonicalMake(raw: string) {
  const key = normalize(raw);
  const aliases: Record<string, string> = {
    VW: "Volkswagen", VOLKSWAGEN: "Volkswagen", GM: "Chevrolet", CHEVROLET: "Chevrolet",
    CITROEN: "Citroen", MERCEDESBENZ: "Mercedes-Benz", DODGERAM: "Ram", RAM: "Ram",
    PORSCHE: "Porsche", PORSHE: "Porsche", CAOACHERY: "Caoa Chery", LANDROVER: "Land Rover",
    RANGEROVER: "Range Rover", MITSUBISHI: "Mitsubishi", HYUNDAI: "Hyundai", PEUGEOT: "Peugeot",
    RENAULT: "Renault", TOYOTA: "Toyota", NISSAN: "Nissan", HONDA: "Honda", FORD: "Ford",
    FIAT: "Fiat", JEEP: "Jeep", AUDI: "Audi", BMW: "BMW", BYD: "BYD", KIA: "Kia",
    CHERY: "Chery", SUZUKI: "Suzuki", SUBARU: "Subaru", VOLVO: "Volvo", JAC: "JAC",
    GWM: "GWM", HAVAL: "Haval", TROLLER: "Troller",
  };
  return aliases[key] ?? raw.trim();
}

function cleanModel(raw: string) {
  return raw
    .replace(/^[\s:;,.\-–—]+|[\s:;,.\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:de|do|dos)\s+(?:ano|anos)\s*$/i, "")
    .trim();
}

function validModel(model: string) {
  if (model.length < 2 || model.length > 80) return false;
  if (/^(linha|ve[ií]culos?|autom[oó]veis?|modelos?|produtos?|todos?)$/i.test(model)) return false;
  return /[A-Za-zÀ-ÿ0-9]/.test(model);
}

function expandYear(raw: string) {
  const value = Number(raw);
  if (!Number.isInteger(value)) return value;
  if (raw.length === 2) return value >= 50 ? 1900 + value : 2000 + value;
  return value;
}

function extractVehicleApplications(html: string): VehicleApplication[] {
  const lines = textLines(html);
  const applications = new Map<string, VehicleApplication>();
  const add = (makeRaw: string, modelRaw: string, fromRaw: string, toRaw: string, sourceText: string, confidence: number) => {
    const vehicleMake = canonicalMake(makeRaw);
    const vehicleModel = cleanModel(modelRaw);
    const yearFrom = expandYear(fromRaw);
    const yearTo = expandYear(toRaw);
    if (!validModel(vehicleModel) || !Number.isInteger(yearFrom) || !Number.isInteger(yearTo)) return;
    if (yearFrom < 1950 || yearTo > 2100 || yearFrom > yearTo) return;
    const key = `${normalize(vehicleMake)}|${normalize(vehicleModel)}|${yearFrom}|${yearTo}`;
    const existing = applications.get(key);
    if (!existing || confidence > existing.confidence) {
      applications.set(key, { vehicleMake, vehicleModel, yearFrom, yearTo, sourceText: sourceText.slice(0, 500), confidence });
    }
  };

  const paren = new RegExp(`\\b(${MAKE_PATTERN})\\s+([^\\n()]{1,80}?)\\s*\\(\\s*((?:19|20)\\d{2})\\s*(?:-|–|—|/|a|até)\\s*((?:19|20)\\d{2})\\s*\\)`, "gi");
  const words = new RegExp(`\\b(${MAKE_PATTERN})\\s+([^\\n.;:]{1,80}?)\\s+(?:a\\s+partir\\s+do\\s+ano\\s+|dos\\s+anos\\s+de\\s+|do\\s+ano\\s+|de\\s+ano\\s+|de\\s+)?((?:19|20)\\d{2})\\s*(?:até|a|ao|-|–|—)\\s*(?:ano\\s+)?((?:19|20)\\d{2})`, "gi");
  const shortYears = new RegExp(`\\\\b(${MAKE_PATTERN})\\\\s+([^\\\\n.;:]{1,80}?)\\\\s+(\\\\d{2})\\\\s*(?:/|-|–|—|a|até)\\\\s*(\\\\d{2})(?!\\\\d)`, "gi");

  const scan = (value: string) => {
    for (const match of value.matchAll(paren)) add(match[1], match[2], match[3], match[4], match[0], 99);
    for (const match of value.matchAll(words)) add(match[1], match[2], match[3], match[4], match[0], 97);
    for (const match of value.matchAll(shortYears)) add(match[1], match[2], match[3], match[4], match[0], 94);
  };

  for (let i = 0; i < lines.length; i++) {
    scan(lines[i]);
    if (i + 1 < lines.length) scan(`${lines[i]} ${lines[i + 1]}`);
    if (i + 2 < lines.length) scan(`${lines[i]} ${lines[i + 1]} ${lines[i + 2]}`);
  }

  // FKS frequentemente separa o cabeçalho "CÓDIGO - MARCA MODELO" da faixa de anos.
  const heading = new RegExp(`(?:^|[-–—]\\s*)(${MAKE_PATTERN})\\s+(.{2,80})$`, "i");
  const yearsOnly = /(?:a\s+partir\s+do\s+ano\s+|dos\s+anos\s+de\s+|do\s+ano\s+|de\s+ano\s+|de\s+)?((?:19|20)\d{2})\s*(?:até|a|ao|-|–|—)\s*(?:ano\s+)?((?:19|20)\d{2})/i;
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(heading);
    if (!head || yearsOnly.test(lines[i])) continue;
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 5); j++) {
      const years = lines[j].match(yearsOnly);
      if (!years) continue;
      add(head[1], head[2], years[1], years[2], `${lines[i]} · ${lines[j]}`, 95);
      break;
    }
  }

  return [...applications.values()].slice(0, 40);
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

    const userClient = createClient(projectUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Sessão inválida" }, 401);

    const { limit = 3 } = await req.json().catch(() => ({}));
    const batch = Math.max(1, Math.min(Number(limit) || 3, 5));
    const admin = createClient(projectUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: memberships } = await admin.from("tenant_memberships").select("tenant_id")
      .eq("user_id", user.id).eq("active", true).in("role", ["owner", "admin", "manager"]);
    const tenantIds = (memberships ?? []).map((value) => value.tenant_id);
    if (!tenantIds.length) return json({ error: "Sem permissão" }, 403);

    const { data: jobs, error } = await admin.from("product_enrichment_jobs")
      .select("id,tenant_id,product_id,attempts,product:products(id,name,manufacturer_code,brand_id,brand:brands(id,name))")
      .in("tenant_id", tenantIds).eq("status", "queued").not("product.manufacturer_code", "is", null)
      .order("created_at").limit(batch);
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
        status: "processing", started_at: new Date().toISOString(), attempts: (job.attempts ?? 0) + 1, last_error: null,
      }).eq("id", job.id);

      let createdCandidateId: string | null = null;
      try {
        const [{ data: sources }, { data: patterns }] = await Promise.all([
          admin.from("manufacturer_catalog_sources")
            .select("id,name,base_url,search_url_template,allowed_domains,supported_fields,image_usage_note")
            .eq("tenant_id", job.tenant_id).eq("brand_id", product.brand_id).eq("status", "active")
            .order("priority", { ascending: false }),
          admin.from("manufacturer_code_patterns").select("code_regex")
            .eq("tenant_id", job.tenant_id).eq("brand_id", product.brand_id).eq("active", true)
            .order("priority", { ascending: false }),
        ]);

        if (patterns?.length && !patterns.some((pattern) => {
          try { return new RegExp(pattern.code_regex, "i").test(code); } catch { return false; }
        })) throw new Error("Código não corresponde ao padrão cadastrado para a marca");

        let matched: Match | null = null;
        let source: CatalogSource | null = null;
        const sourceErrors: string[] = [];
        for (const candidateSource of (sources ?? []) as CatalogSource[]) {
          try {
            const domains = (candidateSource.allowed_domains ?? []).map((value) => value.toLowerCase());
            if (!domains.length) continue;
            matched = await findOfficialPage(buildEntryUrl(candidateSource, code), domains, code, brandName);
            if (matched) {
              source = candidateSource;
              await admin.from("manufacturer_catalog_sources").update({
                last_sync_at: new Date().toISOString(), last_verified_at: new Date().toISOString(), last_error: null,
              }).eq("id", candidateSource.id).eq("tenant_id", job.tenant_id);
              break;
            }
          } catch (sourceError) {
            const reason = sourceError instanceof Error ? sourceError.message : "Falha na fonte";
            sourceErrors.push(`${candidateSource.name}: ${reason}`);
            await admin.from("manufacturer_catalog_sources").update({ last_error: reason, last_verified_at: new Date().toISOString() })
              .eq("id", candidateSource.id).eq("tenant_id", job.tenant_id);
          }
        }

        if (!matched || !source) {
          const suffix = sourceErrors.length ? ` (${sourceErrors.slice(0, 2).join("; ")})` : "";
          throw new Error(`Código não localizado nas fontes oficiais cadastradas${suffix}`);
        }

        const pageText = text(matched.html);
        const ldProduct = jsonLdProduct(matched.html);
        const rawTitle = ldProduct?.name ?? meta(matched.html, "og:title")
          ?? matched.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? product.name;
        const title = cleanTitle(String(rawTitle), brandName);
        const description = text(String(
          ldProduct?.description ?? meta(matched.html, "description") ?? meta(matched.html, "og:description") ?? pageText.slice(0, 1600)
        )).slice(0, 4000);
        const supportedFields = source.supported_fields ?? [];
        const gallery = supportedFields.includes("image") ? extractGallery(matched.html, matched.url.href, ldProduct, title || product.name) : [];
        const applications = supportedFields.includes("vehicle_application") ? extractVehicleApplications(matched.html) : [];
        const suggestedGtin = gtinFromPage(ldProduct, pageText);
        const officialMpn = String(ldProduct?.mpn ?? ldProduct?.sku ?? "").trim() || null;

        const specifications = {
          source_domain: matched.url.hostname,
          source_brand: brandName,
          matched_code: matched.matchedCode,
          requested_manufacturer_code: code,
          official_mpn: officialMpn,
          supported_fields: supportedFields,
          gallery_count: gallery.length,
          vehicle_application_count: applications.length,
        };

        const { data: insertedCandidate, error: insertError } = await admin.from("product_enrichment_candidates").insert({
          tenant_id: job.tenant_id,
          job_id: job.id,
          product_id: job.product_id,
          source_type: "manufacturer",
          source_name: source.name,
          source_url: matched.url.href,
          image_url: gallery[0]?.sourceUrl ?? null,
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
            ...(gallery.length ? [`${gallery.length} imagem(ns) oficial(is) encontrada(s)`] : []),
            ...(applications.length ? [`${applications.length} aplicação(ões) veicular(es) estruturada(s)`] : []),
            ...(officialMpn && normalize(officialMpn).includes(matched.matchedCode) ? ["Código também presente nos dados estruturados"] : []),
          ],
          status: "pending",
          license_name: source.image_usage_note || null,
        }).select("id").single();
        if (insertError || !insertedCandidate) throw insertError ?? new Error("Não foi possível criar a sugestão");
        createdCandidateId = insertedCandidate.id;

        if (gallery.length) {
          const { error: galleryError } = await admin.from("product_enrichment_candidate_images").insert(gallery.map((image) => ({
            tenant_id: job.tenant_id,
            candidate_id: insertedCandidate.id,
            product_id: job.product_id,
            source_url: image.sourceUrl,
            alt: image.alt,
            sort_order: image.sortOrder,
            is_primary: image.isPrimary,
            selected: true,
          })));
          if (galleryError) throw galleryError;
        }

        if (applications.length) {
          const { error: applicationError } = await admin.from("product_enrichment_candidate_applications").insert(applications.map((application) => ({
            tenant_id: job.tenant_id,
            candidate_id: insertedCandidate.id,
            product_id: job.product_id,
            vehicle_make: application.vehicleMake,
            vehicle_model: application.vehicleModel,
            year_from: application.yearFrom,
            year_to: application.yearTo,
            source_text: application.sourceText,
            confidence: application.confidence,
            selected: true,
          })));
          if (applicationError) throw applicationError;
        }

        await admin.from("product_enrichment_jobs").update({ status: "review", finished_at: new Date().toISOString(), last_error: null })
          .eq("id", job.id);
        results.push({
          jobId: job.id,
          status: "review",
          sourceUrl: matched.url.href,
          sourceName: source.name,
          imageFound: gallery.length > 0,
          galleryImages: gallery.length,
          applications: applications.length,
        });
      } catch (jobError) {
        if (createdCandidateId) {
          await admin.from("product_enrichment_candidates").delete().eq("id", createdCandidateId).eq("tenant_id", job.tenant_id);
        }
        const reason = jobError instanceof Error ? jobError.message : "Falha inesperada";
        await admin.from("product_enrichment_jobs").update({ status: "failed", last_error: reason, finished_at: new Date().toISOString() })
          .eq("id", job.id);
        results.push({ jobId: job.id, status: "failed", reason });
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
