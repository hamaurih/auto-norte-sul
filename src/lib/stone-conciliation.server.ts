import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integration-crypto.server";

const STONE_API = "https://conciliation.stone.com.br/v2";
const DEFAULT_WEBHOOK_URL =
  "https://www.nortesulauto.com.br/api/public/stone/conciliation/webhook";
const MAX_CSV_BYTES = 15 * 1024 * 1024;

type StoneContext = {
  integrationId: string;
  apiKey: string;
  merchantDocument: string;
  webhookUrl: string;
  webhookToken: string;
};

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function basicAuth(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function integrationId(sb: any): Promise<string> {
  const { data, error } = await sb.from("integrations").select("id").eq("slug", "stone").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Integração Stone ainda não foi instalada no banco.");
  return data.id;
}

async function settingsMap(sb: any, tenantId: string, id: string) {
  const { data, error } = await sb
    .from("integration_settings")
    .select("key,value_encrypted,is_secret")
    .eq("tenant_id", tenantId)
    .eq("integration_id", id);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row: any) => [row.key, row]));
}

async function saveSecret(sb: any, tenantId: string, id: string, key: string, value: string) {
  const encrypted = await encryptIntegrationSecret(value);
  const { error } = await sb.from("integration_settings").upsert(
    {
      tenant_id: tenantId,
      integration_id: id,
      key,
      value_encrypted: encrypted,
      is_secret: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,integration_id,key" },
  );
  if (error) throw new Error(error.message);
}

export async function getStoneContext(sb: any, tenantId: string): Promise<StoneContext> {
  const id = await integrationId(sb);
  const settings = await settingsMap(sb, tenantId, id);
  const read = async (key: string) => {
    const row: any = settings.get(key);
    if (!row?.value_encrypted) return "";
    return row.is_secret ? decryptIntegrationSecret(row.value_encrypted) : row.value_encrypted;
  };

  const apiKey = (await read("api_key")).trim();
  const merchantDocument = onlyDigits(await read("merchant_document"));
  const webhookUrl = (await read("webhook_url")).trim() || DEFAULT_WEBHOOK_URL;
  let webhookToken = (await read("webhook_token")).trim();
  if (!webhookToken) {
    webhookToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    await saveSecret(sb, tenantId, id, "webhook_token", webhookToken);
  }

  if (!apiKey) throw new Error("Informe a Chave de API da Stone.");
  if (!/^\d{11}$|^\d{14}$/.test(merchantDocument)) {
    throw new Error("Informe o CPF/CNPJ Stone somente com números.");
  }
  const parsedWebhook = new URL(webhookUrl);
  if (parsedWebhook.protocol !== "https:") throw new Error("O webhook da Stone precisa usar HTTPS.");

  return { integrationId: id, apiKey, merchantDocument, webhookUrl, webhookToken };
}

async function stoneRawRequest(context: StoneContext, path: string, init: RequestInit) {
  return fetch(`${STONE_API}${path}`, {
    ...init,
    headers: {
      Authorization: basicAuth(context.apiKey),
      "x-user-type": "client",
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(12_000),
  });
}

async function stoneRequest(context: StoneContext, path: string, init: RequestInit) {
  const response = await stoneRawRequest(context, path, init);
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Stone respondeu HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response;
}

export async function configureStoneWebhook(sb: any, tenantId: string) {
  const context = await getStoneContext(sb, tenantId);
  const url = new URL(context.webhookUrl);
  url.searchParams.set("token", context.webhookToken);
  const body = JSON.stringify({ url: url.toString() });
  const registration = await stoneRawRequest(context, "/webhook", {
    method: "POST",
    body,
  });
  if (registration.status === 409) {
    await stoneRequest(context, "/webhook", { method: "PUT", body });
  } else if (!registration.ok) {
    const detail = (await registration.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `Stone respondeu HTTP ${registration.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return { integrationId: context.integrationId, webhookUrl: context.webhookUrl };
}

export async function requestStonePixFile(sb: any, tenantId: string, referenceDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) throw new Error("Data de referência inválida.");
  const context = await getStoneContext(sb, tenantId);
  await stoneRequest(
    context,
    `/merchant/${context.merchantDocument}/conciliation-file/pix/${referenceDate}`,
    { method: "POST" },
  );
  return { integrationId: context.integrationId, referenceDate };
}

function parseCsv(text: string): Record<string, string>[] {
  const sample = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (sample.match(/;/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.trim().replace(/^\uFEFF/, ""));
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])),
  );
}

function nullable(value: string | undefined): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}

function decimal(value: string | undefined): number | null {
  const clean = value?.trim();
  if (!clean) return null;
  const normalized = clean.includes(",") && !clean.includes(".") ? clean.replace(",", ".") : clean;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function instant(value: string | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  const date = new Date(clean);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function bool(value: string | undefined): boolean | null {
  if (!value) return null;
  if (["true", "1", "sim"].includes(value.toLowerCase())) return true;
  if (["false", "0", "nao", "não"].includes(value.toLowerCase())) return false;
  return null;
}

function isSafeDownloadUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function processStonePixInbox(sb: any, tenantId: string) {
  const { data: inbox, error } = await sb
    .from("stone_conciliation_inbox")
    .select("id,integration_id,merchant_document,reference_date,download_url_encrypted")
    .eq("tenant_id", tenantId)
    .in("status", ["received", "failed"])
    .order("received_at", { ascending: true })
    .limit(5);
  if (error) throw new Error(error.message);
  let imported = 0;
  let files = 0;
  for (const item of inbox ?? []) {
    await sb.from("stone_conciliation_inbox").update({ status: "processing", attempts: 1 }).eq("id", item.id);
    try {
      const downloadUrl = await decryptIntegrationSecret(item.download_url_encrypted);
      if (!isSafeDownloadUrl(downloadUrl)) throw new Error("URL de download recusada por segurança.");
      const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(20_000), redirect: "error" });
      if (!response.ok) throw new Error(`Download Stone falhou com HTTP ${response.status}.`);
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_CSV_BYTES) throw new Error("Arquivo Stone excede o limite de 15 MB.");
      const csv = await response.text();
      if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) throw new Error("Arquivo Stone excede o limite de 15 MB.");
      const rows = parseCsv(csv);
      const payloads = [];
      for (const raw of rows) {
        const eventId = nullable(raw.id);
        if (!eventId) continue;
        const rowDocument = onlyDigits(raw.merchant__document || item.merchant_document);
        if (rowDocument !== item.merchant_document) throw new Error("CNPJ/CPF do arquivo não corresponde à solicitação.");
        const fingerprint = await sha256(JSON.stringify(raw));
        payloads.push({
          tenant_id: tenantId,
          integration_id: item.integration_id,
          inbox_id: item.id,
          stone_event_id: eventId,
          reference_date: item.reference_date,
          amount: decimal(raw.amount),
          status: nullable(raw.status),
          payment_method: nullable(raw.payment_method),
          created_at_stone: instant(raw.created_at),
          merchant_document: rowDocument,
          pix_type: nullable(raw.pix_transaction__type),
          e2e_id: nullable(raw.pix_transaction__e2e_id),
          pix_key: nullable(raw.pix_transaction__pix_key),
          is_pix_sale_key: bool(raw.pix_transaction__is_pix_sale_key),
          paid_amount: decimal(raw.pix_transaction__paid_amount),
          canceled_amount: decimal(raw.pix_transaction__canceled_amount),
          fee_amount: decimal(raw.pix_transaction__fee_amount),
          expires_at: instant(raw.pix_transaction__expires_in),
          payer_name: nullable(raw.pix_transaction__payer__name),
          payer_document_type: nullable(raw.pix_transaction__payer__document_type),
          payer_document: nullable(raw.pix_transaction__payer__document),
          payer_ispb: nullable(raw.pix_transaction__payer__ispb),
          payer_institution_name: nullable(raw.pix_transaction__payer__institution_name),
          additional_data: nullable(raw.pix_transaction__additional_data),
          terminal_type: nullable(raw.pix_transaction__terminal__type),
          terminal_serial_number: nullable(raw.pix_transaction__terminal__serial_number),
          operation: nullable(raw.pix_transaction__detail__operation),
          provider_datetime: instant(raw.pix_transaction__detail__provider_datetime),
          operation_amount: decimal(raw.pix_transaction__detail__operation_amount),
          qrcode_content: nullable(raw.pix_transaction__detail__qrcode_content),
          description: nullable(raw.pix_transaction__detail__description),
          refund_id: nullable(raw.pix_transaction__detail__refund_id),
          reason: nullable(raw.pix_transaction__detail__reason),
          row_fingerprint: fingerprint,
          raw_row: raw,
          imported_at: new Date().toISOString(),
        });
      }
      for (let offset = 0; offset < payloads.length; offset += 250) {
        const { error: upsertError } = await sb
          .from("stone_pix_transactions")
          .upsert(payloads.slice(offset, offset + 250), { onConflict: "tenant_id,row_fingerprint" });
        if (upsertError) throw new Error(upsertError.message);
      }
      await sb.from("stone_conciliation_inbox").update({
        status: "processed",
        error_message: null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      imported += payloads.length;
      files += 1;
    } catch (cause: any) {
      await sb.from("stone_conciliation_inbox").update({
        status: "failed",
        error_message: String(cause?.message ?? cause).slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
    }
  }
  return { files, imported };
}

export async function resolveStoneWebhookTenant(sb: any, token: string) {
  const id = await integrationId(sb);
  const { data, error } = await sb
    .from("integration_settings")
    .select("tenant_id,value_encrypted")
    .eq("integration_id", id)
    .eq("key", "webhook_token")
    .eq("is_secret", true);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    try {
      const candidate = await decryptIntegrationSecret(row.value_encrypted);
      if (candidate.length === token.length) {
        const a = new TextEncoder().encode(candidate);
        const b = new TextEncoder().encode(token);
        let difference = 0;
        for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
        if (difference === 0) return { tenantId: row.tenant_id, integrationId: id };
      }
    } catch {
      // Ignore malformed legacy secret rows and continue searching.
    }
  }
  return null;
}

export async function enqueueStonePixNotification(
  sb: any,
  owner: { tenantId: string; integrationId: string },
  payload: { type: string; url: string; document: string; referenceDate: string },
) {
  const document = onlyDigits(payload.document);
  if (payload.type !== "pix" || !/^\d{11}$|^\d{14}$/.test(document)) throw new Error("Notificação Stone inválida.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.referenceDate)) throw new Error("Data Stone inválida.");
  if (!isSafeDownloadUrl(payload.url)) throw new Error("URL Stone inválida.");
  const settings = await settingsMap(sb, owner.tenantId, owner.integrationId);
  const configuredDocument = onlyDigits((settings.get("merchant_document") as any)?.value_encrypted ?? "");
  if (configuredDocument !== document) throw new Error("Documento Stone não pertence a esta empresa.");
  const encryptedUrl = await encryptIntegrationSecret(payload.url);
  const payloadHash = await sha256(JSON.stringify(payload));
  const { error } = await sb.from("stone_conciliation_inbox").upsert(
    {
      tenant_id: owner.tenantId,
      integration_id: owner.integrationId,
      notification_type: "pix",
      merchant_document: document,
      reference_date: payload.referenceDate,
      download_url_encrypted: encryptedUrl,
      payload_sha256: payloadHash,
      status: "received",
      error_message: null,
      received_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,notification_type,merchant_document,reference_date" },
  );
  if (error) throw new Error(error.message);
}
