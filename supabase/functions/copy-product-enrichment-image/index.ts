import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const isPrivate = (ip: string) => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip);

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

async function copyImage(
  admin: ReturnType<typeof createClient>,
  sourceUrl: string,
  pathBase: string,
) {
  const source = new URL(sourceUrl);
  await validatePublicHttps(source);

  const response = await fetch(source, {
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: { "user-agent": "AutoNorteSulCatalog/2.0 (+gallery copy)" },
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
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Imagem maior que 5 MB");

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
    const auth = req.headers.get("authorization");
    if (!auth) return json({ error: "Não autenticado" }, 401);

    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Sessão inválida" }, 401);

    const { candidateId } = await req.json();
    if (!candidateId) return json({ error: "Sugestão obrigatória" }, 400);

    const admin = createClient(url, serviceKey);
    const { data: candidate, error } = await admin
      .from("product_enrichment_candidates")
      .select("id,tenant_id,product_id,image_url,storage_url,status")
      .eq("id", candidateId)
      .single();
    if (error || !candidate) return json({ error: "Sugestão não encontrada" }, 404);

    const { data: membership } = await admin
      .from("tenant_memberships")
      .select("role")
      .eq("tenant_id", candidate.tenant_id)
      .eq("user_id", user.id)
      .eq("active", true)
      .in("role", ["owner", "admin", "manager"])
      .maybeSingle();
    if (!membership) return json({ error: "Sem permissão" }, 403);
    if (candidate.status !== "pending") return json({ error: "Sugestão já revisada" }, 409);

    const { data: gallery, error: galleryError } = await admin
      .from("product_enrichment_candidate_images")
      .select("id,source_url,storage_url,sort_order,is_primary,selected")
      .eq("tenant_id", candidate.tenant_id)
      .eq("candidate_id", candidate.id)
      .eq("selected", true)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true });
    if (galleryError) throw galleryError;

    if (gallery?.length) {
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
          failures.push({
            id: image.id,
            error: imageError instanceof Error ? imageError.message : "Falha ao copiar imagem",
          });
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

      return json({ ok: true, storageUrl: firstStorageUrl, copied, total: gallery.length });
    }

    // Compatibilidade com sugestões antigas, que possuíam apenas image_url/storage_url no candidato.
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
