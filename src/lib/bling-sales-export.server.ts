import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptIntegrationSecret } from "@/lib/integration-crypto.server";

const API = "https://api.bling.com.br/Api/v3";
const db = supabaseAdmin as any;
type Job = { job_id: string; tenant_id: string; order_id: string; event_type: string; attempts: number };

async function accessToken(tenantId: string) {
  const { data: cfg, error } = await db.from("bling_config")
    .select("id,active,tenant_id,client_id,client_secret_encrypted,access_token,refresh_token,expires_at")
    .eq("tenant_id", tenantId).eq("active", true).maybeSingle();
  if (error || !cfg?.access_token) throw new Error("Bling não conectado para esta empresa");
  if (Date.parse(cfg.expires_at ?? "") - Date.now() > 90_000) return String(cfg.access_token);
  const id = String(cfg.client_id || process.env.BLING_CLIENT_ID || "");
  const secret = cfg.client_secret_encrypted
    ? await decryptIntegrationSecret(cfg.client_secret_encrypted)
    : String(process.env.BLING_CLIENT_SECRET || "");
  if (!id || !secret || !cfg.refresh_token) throw new Error("Credenciais OAuth incompletas");
  const response = await fetch(API + "/oauth/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded", Accept: "1.0", "enable-jwt": "1" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refresh_token }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error("Renovação do OAuth Bling falhou: HTTP " + response.status);
  const { error: saveError } = await db.from("bling_config").update({
    access_token: payload.access_token, refresh_token: payload.refresh_token ?? cfg.refresh_token,
    expires_at: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", cfg.id);
  if (saveError) throw new Error("Falha ao persistir token OAuth atualizado");
  return String(payload.access_token);
}

async function finish(job: Job, status: "done" | "failed", reason?: string) {
  const now = new Date().toISOString();
  const { error } = await db.from("bling_order_sync_jobs").update({
    status, finished_at: now, updated_at: now, last_error: reason?.slice(0, 450) ?? null,
  }).eq("id", job.job_id).eq("tenant_id", job.tenant_id).eq("status", "processing");
  if (error) throw error;
}

async function processJob(job: Job) {
  const { data: order, error } = await db.from("orders")
    .select("id,tenant_id,status,customer_id,created_at,total,subtotal,discount,shipping,bling_id,bling_sync_status")
    .eq("id", job.order_id).eq("tenant_id", job.tenant_id).maybeSingle();
  if (error || !order) return finish(job, "failed", "Pedido ausente ou inacessível");

  // Vendas canceladas NÃO podem ser exportadas; o ERP permanece fonte oficial.
  if (order.status === "cancelado") return finish(job, "done");
  if (job.event_type !== "paid" || !["pago", "faturado", "enviado", "entregue"].includes(order.status)) {
    return finish(job, "done");
  }
  if (order.bling_id) return finish(job, "done");

  // A criação remota não tem garantia de idempotência em caso de timeout depois do POST.
  // Nunca repetir automaticamente uma tentativa de POST ambígua.
  if (job.attempts > 1) return finish(job, "failed", "Reenvio bloqueado: reconcilie o numeroLoja no Bling antes de tentar novamente");

  const { data: customer, error: customerError } = await db.from("customers")
    .select("bling_id").eq("tenant_id", job.tenant_id).eq("id", order.customer_id).maybeSingle();
  if (customerError || !customer?.bling_id) return finish(job, "failed", "Cliente sem vínculo Bling");
  const { data: lines, error: linesError } = await db.from("order_items")
    .select("product_id,quantity,unit_price,total").eq("tenant_id", job.tenant_id).eq("order_id", job.order_id);
  if (linesError || !lines?.length) return finish(job, "failed", "Itens do pedido não encontrados");
  const ids = [...new Set(lines.map((line: any) => line.product_id))];
  const { data: products, error: productError } = await db.from("products")
    .select("id,bling_id").eq("tenant_id", job.tenant_id).in("id", ids);
  if (productError) return finish(job, "failed", "Produtos não disponíveis para conferência");
  const byProduct = new Map((products ?? []).map((p: any) => [p.id, p.bling_id]));
  const itens = lines.map((l: any) => ({
    produto: { id: Number(byProduct.get(l.product_id)) },
    quantidade: Number(l.quantity),
    valor: Number(l.unit_price),
  }));
  if (itens.some((x: any) => !Number.isSafeInteger(x.produto.id) || x.produto.id <= 0))
    return finish(job, "failed", "Há produtos sem ID de integração Bling");

  // Não criar nota fiscal, contas, pagamentos nem baixar estoque novamente aqui.
  const numeroLoja = "NS-" + order.id;
  const payload = {
    numeroLoja,
    data: new Date(order.created_at).toISOString().slice(0, 10),
    contato: { id: Number(customer.bling_id) },
    itens,
    observacoes: "Registro comercial Norte Sul " + order.id + ". Pagamento confirmado no ERP. Documento fiscal sob controle do vendedor/gestor. Não emitir automaticamente.",
  };
  if (!Number.isSafeInteger(payload.contato.id) || payload.contato.id <= 0)
    return finish(job, "failed", "Identificação de contato Bling inválida");

  // Não exportar pedidos cujos totais divergiriam no Bling: o recibo e o ERP
  // são a fonte da verdade. Exigem mapeamento explícito de desconto/frete.
  const itemsTotal = Number(lines.reduce((acc: number, l: any) => acc + Number(l.total), 0).toFixed(2));
  const orderTotal = Number(order.total);
  if (Math.abs(itemsTotal - orderTotal) > 0.01 || Number(order.discount ?? 0) !== 0 || Number(order.shipping ?? 0) !== 0) {
    return finish(job, "failed", "Pedido exige integração de desconto/frete antes do envio; não é seguro divergir o total no Bling");
  }
  const token = await accessToken(job.tenant_id);
  const response = await fetch(API + "/pedidos/vendas", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json", "enable-jwt": "1" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  const remoteId = body?.data?.id;
  if (!response.ok || !remoteId) {
    // Falha pode ter ocorrido após o Bling salvar; não repetir sem reconciliação.
    await db.from("orders").update({ bling_sync_status: "error", bling_sync_error: "Envio inconclusivo ao Bling; conferir numeroLoja " + numeroLoja })
      .eq("tenant_id", job.tenant_id).eq("id", order.id);
    return finish(job, "failed", "Resposta inconclusiva Bling HTTP " + response.status);
  }
  const { error: saveError } = await db.from("orders").update({
    bling_id: String(remoteId), bling_number: body?.data?.numero ? String(body.data.numero) : null,
    bling_sync_status: "synced", bling_last_sync_at: new Date().toISOString(), bling_sync_error: null,
  }).eq("tenant_id", job.tenant_id).eq("id", order.id);
  if (saveError) return finish(job, "failed", "Bling criou pedido, mas gravação no ERP falhou; reconciliar " + numeroLoja);
  return finish(job, "done");
}

/** Invocado somente pelo cron autenticado; nunca por navegador ou RPC público. */
export async function processBlingPaidSalesQueue() {
  const { data: claimed, error } = await db.rpc("claim_bling_order_sync_jobs", { p_limit: 5 });
  if (error) throw new Error(error.message);
  const result = { checked: 0, processed: 0, failed: 0 };
  for (const job of (claimed ?? []) as Job[]) {
    result.checked += 1;
    try {
      await processJob(job);
      result.processed += 1;
    } catch (e) {
      result.failed += 1;
      await finish(job, "failed", e instanceof Error ? e.message : "Erro de sincronização");
    }
  }
  return result;
}
