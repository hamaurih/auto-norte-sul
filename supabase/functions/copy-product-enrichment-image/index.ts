import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const isPrivate = (ip: string) => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|fc|fd|fe80)/i.test(ip);

async function secureEqual(a: string, b: string) {
  if (!a || !b) return false;
  const encoder = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const aa = new Uint8Array(da);
  const bb = new Uint8Array(db);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function validatePublicHttps(source: URL) {
  if (source.protocol !== "https:" || ["localhost", "localhost.localdomain"].includes(source.hostname.toLowerCase())) {
    throw new Error("Origem de imagem bloqueada");
  }
  const ips = [
    ...(await Deno.resolveDns(source.hostname, "A").catch(() => [])),
    ...(await Deno.resolveDns(source.hostname, "AAAA").catch(() => [])),
  ];
  if (!ips.length || ips.some(isPrivate)) throw new Error("Destino de rede não permitido");
}

async function copyImage(admin: ReturnType<typeof createClient>, sourceUrl: string, pathBase: string) {
  const source = new URL(sourceUrl);
  await validatePublicHttps(source);

  const response = await fetch(source, {
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: { "user-agent": "AutoNorteSulCatalog/2.2 (+selective gallery copy)" },
  });
  if (!response.ok) throw new Error(`A origem respondeu ${response.status}`);

  const mime = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  const allowed: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (!allowed[mime]) throw new Error(`Formato de imagem não permitido: ${mime || "desconhecido"}`);

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 5 * 1024 * 1024) throw new Error("Imagem maior que 5 MB");

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("Imagem vazia");
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Imagem maior que 5 MB");

  // Magic bytes: não confiar somente no Content-Type remoto.
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const pngSig = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  const png = bytes.length >= 8 && pngSig.every((v, i) => bytes[i] === v);
  const webp = bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0,4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
  const realMime = jpeg ? "image/jpeg" : png ? "image/png" : webp ? "image/webp" : null;
  if (!realMime || realMime !== mime) throw new Error("Conteúdo da imagem não corresponde ao formato declarado");

  const path = `${pathBase}.${allowed[mime]}`;
  const { error: uploadError } = await admin.storage
    .from("product-images")
    .upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "31536000" });
  if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) throw uploadError;

  return admin.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Método inválido" }, 405);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("authorization");
    if (!auth) return json({ error: "Não autenticado" }, 401);

    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    const workerMode = await secureEqual(bearer, serviceKey);
    let userId: string | null = null;

    // verify_jwt=false no gateway: validamos explicitamente cada chamada aqui.
    if (!workerMode) {
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: auth } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) return json({ error: "Sessão inválida" }, 401);
      userId = user.id;
    }

    const { candidateId } = await req.json().catch(() => ({}));
    if (!candidateId || typeof candidateId !== "string") return json({ error: "Sugestão obrigatória" }, 400);

    const admin = createClient(url, serviceKey);
    const { data: candidate, error } = await admin
      .from("product_enrichment_candidates")
      .select("id,tenant_id,product_id,image_url,storage_url,status")
      .eq("id", candidateId)
      .single();
    if (error || !candidate) return json({ error: "Sugestão não encontrada" }, 404);

    if (!workerMode) {
      const { data: membership } = await admin
        .from("tenant_memberships")
        .select("role")
        .eq("tenant_id", candidate.tenant_id)
        .eq("user_id", userId!)
        .eq("active", true)
        .in("role", ["owner", "admin", "manager"])
        .maybeSingle();
      if (!membership) return json({ error: "Sem permissão" }, 403);
    }

    if (candidate.status !== "pending") return json({ error: "Sugestão já revisada" }, 409);

    const { data: allGallery, error: galleryError } = await admin
      .from("product_enrichment_candidate_images")
      .select("id,source_url,storage_url,sort_order,is_primary,selected")
      .eq("tenant_id", candidate.tenant_id)
      .eq("candidate_id", candidate.id)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true });
    if (galleryError) throw galleryError;

    const gallery = (allGallery ?? []).filter((image) => image.selected !== false);

    if ((allGallery ?? []).length > 0) {
      if (gallery.length === 0) {
        return json({ ok: true, storageUrl: null, copied: 0, total: 0, available: allGallery?.length ?? 0 });
      }

      let copied = 0;
      const failures: Array<{ id: string; error: string }> = [];
      let firstStorageUrl: string | null = null;

      for (const image of gallery.slice(0, 12)) {
        if (image.storage_url) {
          firstStorageUrl ??= image.storage_url;
          continue;
        }
        try {
          const order = String(Math.max(0, Number(image.sort_order ?? 0))).padStart(2, "0");
          const storageUrl = await copyImage(
            admin,
            image.source_url,
            `${candidate.tenant_id}/${candidate.product_id}/${candidate.id}/${order}-${image.id}`,
          );
          const { error: updateError } = await admin
            .from("product_enrichment_candidate_images")
            .update({ storage_url: storageUrl })
            .eq("id", image.id)
            .eq("tenant_id", candidate.tenant_id)
            .eq("candidate_id", candidate.id);
          if (updateError) throw updateError;
          firstStorageUrl ??= storageUrl;
          copied += 1;
        } catch (imageError) {
          failures.push({ id: image.id, error: imageError instanceof Error ? imageError.message : "Falha ao copiar imagem" });
        }
      }

      if (firstStorageUrl) {
        const { error: candidateUpdateError } = await admin
          .from("product_enrichment_candidates")
          .update({ storage_url: firstStorageUrl })
          .eq("id", candidate.id)
          .eq("tenant_id", candidate.tenant_id);
        if (candidateUpdateError) throw candidateUpdateError;
      }

      if (failures.length) {
        return json({
          error: `${failures.length} imagem(ns) da galeria não puderam ser copiadas`,
          ok: false,
          copied,
          total: gallery.length,
          failures,
        }, 422);
      }

      return json({ ok: true, storageUrl: firstStorageUrl, copied, total: gallery.length, available: allGallery?.length ?? 0 });
    }

    // Compatibilidade exclusiva com sugestões antigas, sem registros na tabela de galeria.
    if (!candidate.image_url) return json({ ok: true, storageUrl: candidate.storage_url ?? null, copied: 0, total: 0 });
    if (candidate.storage_url) return json({ ok: true, storageUrl: candidate.storage_url, copied: 0, total: 1 });

    const storageUrl = await copyImage(
      admin,
      candidate.image_url,
      `${candidate.tenant_id}/${candidate.product_id}/${candidate.id}`,
    );
    const { error: updateError } = await admin
      .from("product_enrichment_candidates")
      .update({ storage_url: storageUrl })
      .eq("id", candidate.id)
      .eq("tenant_id", candidate.tenant_id);
    if (updateError) throw updateError;

    return json({ ok: true, storageUrl, copied: 1, total: 1 });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
