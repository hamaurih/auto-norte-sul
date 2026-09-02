import { createServerFn } from "@tanstack/react-start";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;
const CATALOG_ROLES = ["owner", "admin", "manager", "stock"];

const ALLOWED_MIME: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h)
    || /^(::1|::|fc|fd|fe80)/i.test(h);
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const [a, b] = parts.map((p) => Number(p));
  if (parts.some((p) => !/^\d{1,3}$/.test(p)) || [a, b].some((n) => Number.isNaN(n))) return true;
  const o = parts.map(Number) as [number, number, number, number];
  if (o.some((n) => n < 0 || n > 255)) return true;
  if (o[0] === 0 || o[0] === 10 || o[0] === 127) return true; // this-network, private, loopback
  if (o[0] === 169 && o[1] === 254) return true; // link-local
  if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) return true; // private
  if (o[0] === 192 && o[1] === 168) return true; // private
  if (o[0] === 192 && o[1] === 0 && (o[2] === 0 || o[2] === 2)) return true; // reserved/test
  if (o[0] === 198 && (o[1] === 18 || o[1] === 19)) return true; // benchmarking
  if (o[0] === 198 && o[1] === 51 && o[2] === 100) return true; // test-net-2
  if (o[0] === 203 && o[1] === 0 && o[2] === 113) return true; // test-net-3
  if (o[0] === 100 && o[1]! >= 64 && o[1]! <= 127) return true; // CGNAT
  if (o[0]! >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isBlockedIp(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!ip) return true;
  if (ip.includes(":")) {
    if (ip === "::" || ip === "::1" || ip === "::0") return true;
    // IPv4-mapped / IPv4-compatible
    const mapped = /(?:^::ffff:|^::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(ip);
    if (mapped) return isBlockedIpv4(mapped[1]!);
    if (/^f[cd]/.test(ip)) return true; // ULA fc00::/7
    if (/^fe[89ab]/.test(ip)) return true; // link-local fe80::/10
    if (/^ff/.test(ip)) return true; // multicast
    return false;
  }
  return isBlockedIpv4(ip);
}

let dnsModule: typeof import("node:dns/promises") | null | undefined;

async function loadDns() {
  if (dnsModule !== undefined) return dnsModule;
  try {
    dnsModule = await import("node:dns/promises");
  } catch {
    dnsModule = null;
  }
  return dnsModule;
}

/** Resolve o hostname e rejeita se qualquer endereço cair em faixa não pública. */
async function assertResolvesToPublicAddress(hostname: string): Promise<void> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(literal) || literal.includes(":")) {
    if (isBlockedIp(literal)) throw new Error("Destino de rede não permitido");
    return;
  }
  const dns = await loadDns();
  if (!dns) return; // runtime sem node:dns: mantém validações literais existentes
  let addresses: string[] = [];
  try {
    const looked = await dns.lookup(literal, { all: true });
    addresses = looked.map((entry) => entry.address);
  } catch {
    addresses = [];
  }
  if (addresses.length === 0) {
    try {
      const [v4, v6] = await Promise.allSettled([dns.resolve4(literal), dns.resolve6(literal)]);
      if (v4.status === "fulfilled") addresses.push(...v4.value);
      if (v6.status === "fulfilled") addresses.push(...v6.value);
    } catch {
      /* ignore */
    }
  }
  if (addresses.length === 0) throw new Error("Não foi possível resolver o host de origem");
  if (addresses.some((address) => isBlockedIp(address))) {
    throw new Error("Destino de rede não permitido");
  }
}

async function assertPublicHttps(target: URL): Promise<void> {
  if (target.protocol !== "https:") throw new Error("Somente URLs HTTPS públicas são aceitas");
  if (isPrivateHost(target.hostname)) throw new Error("Destino de rede não permitido");
  await assertResolvesToPublicAddress(target.hostname);
}


function detectMagic(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length > 8 && png.every((b, i) => bytes[i] === b)) return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(bytes.slice(from, to)));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

/** Manual redirect handling so every hop is revalidated against SSRF rules. */
async function safeFetch(startUrl: URL): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= 3; hop++) {
    await assertPublicHttps(current);
    const response = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": "AutoNorteSulCatalog/1.0 (+manual image import)" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirecionamento inválido na origem");
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error("Muitos redirecionamentos na origem");
}

const sanitizeSegment = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

async function requireCatalogMembership(supabase: any, userId: string, tenantId: string) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: string }) => CATALOG_ROLES.includes(item.role));
  if (!membership) throw new Error("Usuário sem permissão para administrar o catálogo");
}

export type ImportProductImageInput = {
  sourceUrl: string;
  sku?: string | null;
  productId?: string | null;
};

/**
 * Copia uma imagem externa para o bucket público `product-images` e devolve a
 * URL pública permanente. Nenhuma URL externa é reutilizada como hotlink.
 */
export const importProductImageUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ImportProductImageInput) => {
    const sourceUrl = String(input?.sourceUrl ?? "").trim();
    if (!sourceUrl) throw new Error("URL de origem obrigatória");
    return { sourceUrl, sku: input?.sku ?? null, productId: input?.productId ?? null };
  })
  .handler(async ({ data, context }) => {
    const supabase = tdb(context.supabase);
    const tenantId = context.tenantId;
    await requireCatalogMembership(supabase, context.userId, tenantId);

    let target: URL;
    try {
      target = new URL(data.sourceUrl);
    } catch {
      throw new Error("URL de origem inválida");
    }

    if (data.productId) {
      const { data: product } = await supabase
        .from("products")
        .select("id")
        .eq("id", data.productId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!product) throw new Error("Produto não encontrado neste ambiente");
    }

    const response = await safeFetch(target);
    if (!response.ok) throw new Error(`A origem respondeu ${response.status}`);

    const mime = (response.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase();
    const declaredExt = ALLOWED_MIME[mime];
    if (!declaredExt) throw new Error(`Formato de imagem não permitido: ${mime || "desconhecido"}`);

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_BYTES) throw new Error("Imagem maior que 5 MB");

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("Imagem vazia na origem");
    if (bytes.byteLength > MAX_BYTES) throw new Error("Imagem maior que 5 MB");

    const realExt = detectMagic(bytes);
    if (!realExt) throw new Error("Conteúdo não é JPEG, PNG ou WebP");
    if (realExt !== declaredExt) throw new Error("Conteúdo da imagem não corresponde ao content-type");

    const scope = data.productId || (data.sku ? sanitizeSegment(data.sku) : "") || "manual";
    const path = `${tenantId}/${scope}/manual/${crypto.randomUUID()}.${realExt}`;
    const contentType = realExt === "jpg" ? "image/jpeg" : `image/${realExt}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: uploadError } = await (supabaseAdmin as any).storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
    if (uploadError) throw new Error(uploadError.message);

    const publicUrl: string = (supabaseAdmin as any).storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    if (!publicUrl?.startsWith("https://")) throw new Error("URL pública inválida gerada pelo Storage");

    return { ok: true, publicUrl, path, bytes: bytes.byteLength, contentType };
  });
