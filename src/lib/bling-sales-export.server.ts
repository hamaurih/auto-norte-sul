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

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

async function ensureBlingCustomerId(tenantId: string, customer: any, token: string) {
  const current = Number(customer?.bling_id);
  if (Number.isSafeInteger(current) && current > 0) return current;

  const document = digits(customer?.document);
  // Reaproveita vínculo já importado do Bling quando o mesmo CPF/CNPJ entrou
  // novamente pelo e-commerce com outro usuário.
  if (document) {
    const { data: mapped, error: mappedError } = await db.from("customers")
      .select("bling_id")
      .eq("tenant_id", tenantId)
      .eq("document", document)
      .neq("id", customer.id)
      .not("bling_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (mappedError) throw new Error("Falha ao reconciliar cliente com a carteira Bling");
    const mappedId = Number(mapped?.bling_id);
    if (Number.isSafeInteger(mappedId) && mappedId > 0) {
      const { error: linkError } = await db.from("customers")
        .update({ bling_id: mappedId, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", customer.id).is("bling_id", null);
      if (linkError) throw new Error("Falha ao gravar vínculo do cliente Bling no ERP");
      return mappedId;
    }
  }

  const name = String(customer?.name ?? "").trim();
  if (!name) throw new Error("Cliente sem nome para cadastro no Bling");
  const phone = digits(customer?.phone);
  const payload = {
    nome: name,
    tipo: document.length === 14 ? "J" : "F",
    situacao: "A",
    ...(document ? { numeroDocumento: document } : {}),
    ...(customer?.email ? { email: String(customer.email).trim().toLowerCase() } : {}),
    ...(phone ? { celular: phone } : {}),
  };

  const response = await fetch(API + "/contatos", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json",
      "enable-jwt": "1",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  const remoteId = Number(body?.data?.id);
  if (!response.ok || !Number.isSafeInteger(remoteId) || remoteId <= 0) {
    throw new Error("Cadastro de contato no Bling inconclusivo (HTTP " + response.status + ")");
  }

  const { error: saveError } = await db.from("customers")
    .update({ bling_id: remoteId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", customer.id);
  if (saveError) throw new Error("Contato criado no Bling, mas vínculo não foi salvo no ERP");
  return remoteId;
}

async function finish(job: Job, status: "done" | "failed", reason?: string) {
  const now = new Date().toISOString();
  const { error } = await db.from("bling_order_sync_jobs").update({
    status, finished_at: now, updated_at: now, last_error: reason?.slice(0, 450) ?? null,
  }).eq("id", job.job_id).eq("tenant_id", job.tenant_id).eq("status", "processing");
  if (error) throw error;
}

async function retryReadOnly(job: Job, reason: string) {
  // A GET request cannot create a remote order. Requeuing after API downtime is safe,
  // unlike automatically repeating an ambiguous POST.
  if (job.attempts >= 5) {
    await db.from("orders").update({
      bling_sync_status: "error", bling_sync_error: reason.slice(0, 250),
    }).eq("id",job.order_id).eq("tenant_id",job.tenant_id);
    return finish(job,"failed",reason);
  }
  const minutes = Math.min(60, 2 ** Math.min(job.attempts,5) * 2);
  const {error} = await db.from("bling_order_sync_jobs").update({
    status:"queued",started_at:null,finished_at:null,updated_at:new Date().toISOString(),
    scheduled_at:new Date(Date.now()+minutes*60_000).toISOString(),
    last_error:reason.slice(0,450),
  }).eq("id",job.job_id).eq("tenant_id",job.tenant_id).eq("status","processing");
  if(error) throw error;
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

  // Nunca gerar um segundo pedido se a primeira tentativa já foi reconhecida no Bling.
  // O número de referência do ERP será consultado antes de qualquer POST.

  const token = await accessToken(job.tenant_id);
  const { data: customer, error: customerError } = await db.from("customers")
    .select("id,bling_id,name,email,phone,document")
    .eq("tenant_id", job.tenant_id).eq("id", order.customer_id).maybeSingle();
  if (customerError || !customer) return finish(job, "failed", "Cliente do pedido não encontrado");
  let customerBlingId: number;
  try {
    customerBlingId = await ensureBlingCustomerId(job.tenant_id, customer, token);
  } catch (e) {
    return finish(job, "failed", e instanceof Error ? e.message : "Falha ao preparar cliente no Bling");
  }
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

  // Não exportar pedidos cujos totais divergiriam no Bling: o recibo e o ERP
  // são a fonte da verdade. Exigem mapeamento explícito de desconto/frete.
  const itemsTotal = Number(lines.reduce((acc: number, l: any) => acc + Number(l.total), 0).toFixed(2));
  const orderTotal = Number(order.total);
  const discount = Number(order.discount ?? 0);
  const shipping = Number(order.shipping ?? 0);
  if (discount < 0 || shipping < 0 ||
      Math.abs(Number((itemsTotal - discount + shipping).toFixed(2)) - orderTotal) > 0.01) {
    return finish(job, "failed", "Totais da venda não conciliam com itens, desconto e frete; nenhuma exportação feita");
  }

  // Não criar nota fiscal, contas, pagamentos nem baixar estoque novamente aqui.
  const numeroLoja = "NS-" + order.id;
  const payload = {
    numeroLoja,
    data: new Date(order.created_at).toISOString().slice(0, 10),
    contato: { id: customerBlingId },
    itens,
    ...(discount > 0 ? { desconto: { valor: discount, unidade: "REAL" } } : {}),
    ...(shipping > 0 ? { transporte: { frete: shipping } } : {}),
    observacoes: "Registro comercial Norte Sul " + order.id + ". Pagamento confirmado no ERP. Documento fiscal sob controle do vendedor/gestor. Não emitir automaticamente.",
  };
  if (!Number.isSafeInteger(payload.contato.id) || payload.contato.id <= 0)
    return finish(job, "failed", "Identificação de contato Bling inválida");

  const lookup = await fetch(API + "/pedidos/vendas?" + new URLSearchParams({
    pagina:"1",limite:"10","numerosLojas[]":numeroLoja,
  }),{
    headers:{ Authorization:"Bearer " + token,Accept:"application/json","enable-jwt":"1" },
    signal:AbortSignal.timeout(15000),
  });
  if (!lookup.ok) {
    const reason="Consulta Bling indisponível (HTTP "+lookup.status+"), operação remota não iniciada";
    if (lookup.status===429 || lookup.status>=500) return retryReadOnly(job,reason);
    return finish(job,"failed",reason);
  }
  const prior = await lookup.json().catch(()=>({}));
  const existing = (Array.isArray(prior?.data) ? prior.data : []).find(
    (item:any)=>String(item.numeroLoja??"")===numeroLoja && item.id
  );
  if (existing) {
    const {error:reconcileError}=await db.from("orders").update({
      bling_id:String(existing.id),bling_number:existing.numero?String(existing.numero):null,
      bling_sync_status:"synced",bling_last_sync_at:new Date().toISOString(),bling_sync_error:null,
    }).eq("tenant_id",job.tenant_id).eq("id",order.id);
    return finish(job,reconcileError?"failed":"done",reconcileError?"Pedido existente no Bling; falha de reconciliação no ERP":undefined);
  }
  if (job.attempts > 1) return finish(job, "failed", "Tentativa anterior inconclusiva: conferir o pedido no Bling antes de reenviar");
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

/** Processa somente a venda recém-paga, mantendo a fila como fallback. */
export async function processBlingPaidSaleNow(tenantId: string, orderId: string) {
  const { data: pending, error } = await db.from("bling_order_sync_jobs")
    .select("id,tenant_id,order_id,event_type,status,attempts,scheduled_at")
    .eq("tenant_id", tenantId).eq("order_id", orderId).eq("event_type", "paid").maybeSingle();
  if (error) throw new Error(error.message);
  if (!pending || pending.status === "done") return { checked: 0, processed: 0, failed: 0 };
  if (pending.status !== "queued" || Date.parse(String(pending.scheduled_at ?? "")) > Date.now()) {
    return { checked: 0, processed: 0, failed: 0 };
  }

  const now = new Date().toISOString();
  const nextAttempts = Number(pending.attempts ?? 0) + 1;
  const { data: claimed, error: claimError } = await db.from("bling_order_sync_jobs").update({
    status: "processing",
    started_at: now,
    finished_at: null,
    attempts: nextAttempts,
    last_error: null,
    updated_at: now,
  }).eq("id", pending.id).eq("tenant_id", tenantId).eq("status", "queued")
    .select("id,tenant_id,order_id,event_type,attempts").maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { checked: 0, processed: 0, failed: 0 };

  const job: Job = {
    job_id: claimed.id,
    tenant_id: claimed.tenant_id,
    order_id: claimed.order_id,
    event_type: claimed.event_type,
    attempts: Number(claimed.attempts ?? nextAttempts),
  };

  try {
    await processJob(job);
    return { checked: 1, processed: 1, failed: 0 };
  } catch (e) {
    await finish(job, "failed", e instanceof Error ? e.message : "Erro de sincronização");
    return { checked: 1, processed: 0, failed: 1 };
  }
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
