// deno-lint-ignore-file no-explicit-any
/**
 * Bridge seguro para o assistente A&S Business.
 *
 * O contexto é sempre limitado ao tenant informado pelo storefront e ao
 * usuário autenticado. O body pode sugerir IDs, mas nunca escolhe user_id,
 * grupo de preço ou dados de outro tenant.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const ADMIN = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface ChatRequest {
  session_id?: string;
  pergunta: string;
  contexto_pagina?: string;
  carrinho?: Array<{ product_id: string; qty: number }>;
  produto_atual?: string;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))
      ? origin
      : ALLOWED_ORIGINS[0] ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-slug",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getCaller(req: Request): Promise<{ id: string } | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await ADMIN.auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id };
}

async function resolveTenant(req: Request) {
  const slug = (
    req.headers.get("x-tenant-slug") ||
    Deno.env.get("PUBLIC_TENANT_SLUG") ||
    "norte-sul-real"
  ).trim();
  const { data, error } = await ADMIN.from("tenants").select("id, slug").eq("slug", slug).maybeSingle();
  if (error || !data) throw new Error("tenant storefront inválido");
  return data as { id: string; slug: string };
}

async function loadContext(body: ChatRequest, tenantId: string, userId: string | null) {
  const [{ data: cats }, { data: profile }, { data: customer }] = await Promise.all([
    ADMIN.from("categories")
      .select("name, slug")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .limit(20),
    userId
      ? ADMIN.from("profiles").select("customer_group, b2b_status").eq("id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? ADMIN.from("customers").select("customer_group, b2b_status")
        .eq("tenant_id", tenantId).eq("user_id", userId).eq("active", true).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const customerGroup = customer?.customer_group ?? profile?.customer_group ?? "b2c";
  const b2bApproved = Boolean(
    userId &&
    customer?.b2b_status === "approved" &&
    ["revendedor", "oficina", "distribuidor"].includes(customerGroup),
  );
  const priceColumn = b2bApproved ? "price_b2b" : "price_b2c";

  const [{ data: product }, { data: cart }, { data: orders }] = await Promise.all([
    body.produto_atual && isUuid(body.produto_atual)
      ? ADMIN.from("products")
        .select(`id, sku, name, short_description, stock, ${priceColumn}`)
        .eq("tenant_id", tenantId).eq("active", true).is("deleted_at", null)
        .eq("id", body.produto_atual).maybeSingle()
      : Promise.resolve({ data: null }),
    body.carrinho?.length
      ? ADMIN.from("products")
        .select(`id, sku, name, stock, ${priceColumn}`)
        .eq("tenant_id", tenantId).eq("active", true).is("deleted_at", null)
        .in("id", body.carrinho.map((item) => item.product_id))
      : Promise.resolve({ data: [] }),
    userId
      ? ADMIN.from("orders").select("id, status, total, created_at")
        .eq("tenant_id", tenantId).eq("user_id", userId)
        .is("deleted_at", null).order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    categories: cats ?? [],
    product: product ?? null,
    cart: cart ?? [],
    orders: orders ?? [],
    customer_group: b2bApproved ? customerGroup : "b2c",
    b2bApproved,
  };
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  const origin = req.headers.get("origin") ?? "";
  if (ALLOWED_ORIGINS.length > 0 && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: "origin_not_allowed" }, 403, headers);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);

  const caller = await getCaller(req);
  const started = Date.now();
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400, headers);
  }
  const pergunta = typeof body.pergunta === "string" ? body.pergunta.trim().slice(0, 4000) : "";
  if (!pergunta) return json({ error: "pergunta obrigatória" }, 400, headers);
  if (body.carrinho && (!Array.isArray(body.carrinho) || body.carrinho.length > 50 || body.carrinho.some((item) => !isUuid(item.product_id) || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 1000))) {
    return json({ error: "carrinho inválido" }, 400, headers);
  }

  try {
    const tenant = await resolveTenant(req);
    const safeBody: ChatRequest = {
      ...body,
      pergunta,
      session_id: isUuid(body.session_id) ? body.session_id : undefined,
      produto_atual: isUuid(body.produto_atual) ? body.produto_atual : undefined,
    };
    const ctx = await loadContext(safeBody, tenant.id, caller?.id ?? null);
    const AES_URL = Deno.env.get("AES_AI_API_URL");
    const AES_KEY = Deno.env.get("AES_AI_API_KEY");
    let reply = "";
    let suggestions: any[] = [];
    let recommended_action: any = null;
    let status = "ok";
    let error: string | null = null;

    if (!AES_URL || !AES_KEY) {
      reply = "A integração com A&S Business ainda não foi configurada.";
      status = "stub";
    } else {
      try {
        const parsedUrl = new URL(AES_URL);
        if (parsedUrl.protocol !== "https:") throw new Error("AES_AI_API_URL deve usar HTTPS");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const upstream = await fetch(parsedUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${AES_KEY}` },
          body: JSON.stringify({
            user_id: caller?.id ?? null,
            session_id: safeBody.session_id,
            question: pergunta,
            page_context: body.contexto_pagina?.slice(0, 500),
            user_type: caller ? (ctx.b2bApproved ? "b2b" : "customer") : "guest",
            customer_group: ctx.customer_group,
            context: ctx,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!upstream.ok) throw new Error(`A&S retornou ${upstream.status}`);
        const data = await upstream.json().catch(() => ({}));
        reply = typeof data.reply === "string" ? data.reply.slice(0, 10000) : typeof data.answer === "string" ? data.answer.slice(0, 10000) : "";
        suggestions = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 20) : Array.isArray(data.products) ? data.products.slice(0, 20) : [];
        recommended_action = data.recommended_action ?? data.action ?? null;
      } catch (caught) {
        status = "erro";
        error = caught instanceof Error ? caught.message : String(caught);
        reply = "Não consegui falar com o assistente agora. Tente novamente em instantes.";
      }
    }

    const latency_ms = Date.now() - started;
    await ADMIN.from("ai_tool_logs").insert({
      session_id: safeBody.session_id ?? null,
      user_id: caller?.id ?? null,
      tool_name: "aes-ai-chat",
      input: { pergunta, contexto_pagina: body.contexto_pagina?.slice(0, 500), customer_group: ctx.customer_group },
      output: { reply, suggestions, recommended_action },
      status,
      error,
      latency_ms,
    });
    if (safeBody.session_id && caller) {
      await ADMIN.from("ai_chat_messages").insert([
        { session_id: safeBody.session_id, role: "user", content: pergunta },
        { session_id: safeBody.session_id, role: "assistant", content: reply, suggestions, recommended_action, latency_ms },
      ]);
    }
    return json({ reply, suggestions, recommended_action, logs: { status, latency_ms, error } }, 200, headers);
  } catch (caught) {
    return json({ error: caught instanceof Error ? caught.message : "request_failed" }, 500, headers);
  }
});
