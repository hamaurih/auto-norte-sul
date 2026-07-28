// deno-lint-ignore-file no-explicit-any
/**
 * aes-ai-chat — bridge to the external "A&S Business" AI platform.
 *
 * Receives context from the app, forwards to A&S Business, logs the call and
 * returns { reply, suggestions, recommended_action, logs }.
 *
 * Required secrets (set via Lovable Cloud):
 *   AES_AI_API_URL         e.g. https://api.aesbusiness.example/chat
 *   AES_AI_API_KEY         bearer token issued by A&S Business
 *
 * Server-only fetches (products / categories / stock / orders) run through the
 * service-role Supabase client, but we always scope every query with the
 * caller's user_id + user_type + customer_group so private/atacado data never
 * leaks to callers that shouldn't see it.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ChatRequest {
  user_id?: string;
  session_id?: string;
  pergunta: string;
  contexto_pagina?: string;
  user_type?: string;             // "b2c" | "b2b" | "vendedor" | "admin" | "gerente" | "guest"
  customer_group?: string;        // b2c | b2b_pendente | revendedor | oficina | distribuidor
  carrinho?: Array<{ product_id: string; qty: number }>;
  produto_atual?: string;
}

const ADMIN = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function loadContext(body: ChatRequest) {
  const b2bApproved = ["revendedor", "oficina", "distribuidor"].includes(body.customer_group ?? "");
  const priceCol = b2bApproved ? "price_b2b" : "price_b2c";

  const [{ data: cats }, { data: prod }] = await Promise.all([
    ADMIN.from("categories").select("name, slug").eq("active", true).limit(20),
    body.produto_atual
      ? ADMIN.from("products").select(`id, sku, name, short_description, stock, ${priceCol}`).eq("id", body.produto_atual).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let cart: any[] = [];
  if (body.carrinho?.length) {
    const ids = body.carrinho.map((c) => c.product_id);
    const { data } = await ADMIN.from("products").select(`id, sku, name, stock, ${priceCol}`).in("id", ids);
    cart = data ?? [];
  }

  let orders: any[] = [];
  if (body.user_id) {
    const { data } = await ADMIN.from("orders").select("id, status, total, created_at").eq("user_id", body.user_id).order("created_at", { ascending: false }).limit(5);
    orders = data ?? [];
  }

  return { categories: cats ?? [], product: prod ?? null, cart, orders, b2bApproved };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const started = Date.now();
  let body: ChatRequest;
  try { body = await req.json(); } catch { return json({ error: "invalid_body" }, 400); }
  if (!body.pergunta) return json({ error: "pergunta obrigatória" }, 400);

  const ctx = await loadContext(body);

  const AES_URL = Deno.env.get("AES_AI_API_URL");
  const AES_KEY = Deno.env.get("AES_AI_API_KEY");

  let reply = "";
  let suggestions: any[] = [];
  let recommended_action: any = null;
  let status = "ok";
  let error: string | null = null;

  if (!AES_URL || !AES_KEY) {
    reply = "A integração com A&S Business ainda não foi configurada. Configure AES_AI_API_URL e AES_AI_API_KEY.";
    status = "stub";
  } else {
    try {
      const upstream = await fetch(AES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${AES_KEY}` },
        body: JSON.stringify({
          user_id: body.user_id,
          session_id: body.session_id,
          question: body.pergunta,
          page_context: body.contexto_pagina,
          user_type: body.user_type,
          customer_group: body.customer_group,
          context: ctx,
        }),
      });
      if (!upstream.ok) {
        status = "erro";
        error = `A&S retornou ${upstream.status}`;
        reply = "Não consegui falar com o assistente agora. Tente novamente em instantes.";
      } else {
        const data = await upstream.json().catch(() => ({}));
        reply = data.reply ?? data.answer ?? "";
        suggestions = data.suggestions ?? data.products ?? [];
        recommended_action = data.recommended_action ?? data.action ?? null;
      }
    } catch (e) {
      status = "erro";
      error = e instanceof Error ? e.message : String(e);
      reply = "Falha de conexão com o assistente.";
    }
  }

  const latency_ms = Date.now() - started;

  // Log tool call
  await ADMIN.from("ai_tool_logs").insert({
    session_id: body.session_id ?? null,
    user_id: body.user_id ?? null,
    tool_name: "aes-ai-chat",
    input: { pergunta: body.pergunta, contexto_pagina: body.contexto_pagina, user_type: body.user_type, customer_group: body.customer_group },
    output: { reply, suggestions, recommended_action },
    status,
    error,
    latency_ms,
  });

  // Persist message pair if session exists
  if (body.session_id) {
    await ADMIN.from("ai_chat_messages").insert([
      { session_id: body.session_id, role: "user", content: body.pergunta },
      { session_id: body.session_id, role: "assistant", content: reply, suggestions, recommended_action, latency_ms },
    ]);
  }

  return json({ reply, suggestions, recommended_action, logs: { status, latency_ms, error } });
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
