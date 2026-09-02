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

function assertPublicHttps(target: URL): void {
  if (target.protocol !== "https:") throw new Error("Somente URLs HTTPS públicas são aceitas");
  if (isPrivateHost(target.hostname)) throw new Error("Destino de rede não permitido");
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
    assertPublicHttps(current);
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
