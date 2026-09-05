import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTenantRole } from "@/lib/auth-guards";
import { getBlingCredentials } from "@/lib/bling.functions";

const BLING_API = "https://api.bling.com.br/Api/v3";
const TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";
const PAGE_SIZE = 100;
const MIN_INTERVAL_MS = 450;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requireAdmin(context: any) {
  await requireTenantRole(context.supabase, context.userId, context.tenantId, ["owner", "admin"]);
}

async function getConfig(tenantId: string) {
  const { data, error } = await (supabaseAdmin as any)
    .from("bling_config")
    .select("id,tenant_id,last_authorized_at,expires_at,client_id,client_secret_encrypted,access_token,refresh_token")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Configuração Bling não encontrada.");
  return data as any;
}

async function accessToken(tenantId: string) {
  const cfg = await getConfig(tenantId);
  const expiresAt = cfg.expires_at ? new Date(cfg.expires_at).getTime() : 0;
  if (cfg.access_token && expiresAt - Date.now() > 60_000) return String(cfg.access_token);
  if (!cfg.refresh_token) throw new Error("Bling não conectado no ambiente oficial. Reconecte em Ecossistema → Bling antes de importar a carteira.");

  const { clientId, clientSecret } = await getBlingCredentials(supabaseAdmin as any, tenantId, cfg);
  if (!clientId || !clientSecret) throw new Error("Credenciais do aplicativo Bling não estão configuradas no ambiente oficial.");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(cfg.refresh_token) }).toString(),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`Não foi possível renovar o acesso ao Bling (HTTP ${response.status}). Reconecte o Bling.`);

  const nextExpires = new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString();
  const { error } = await (supabaseAdmin as any)
    .from("bling_config")
    .update({ access_token: payload.access_token, refresh_token: payload.refresh_token ?? cfg.refresh_token, expires_at: nextExpires, updated_at: new Date().toISOString() })
    .eq("id", cfg.id)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return String(payload.access_token);
}

async function fetchContacts(token: string, page: number) {
  const response = await fetch(`${BLING_API}/contatos?pagina=${page}&limite=${PAGE_SIZE}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (response.status === 429) {
    await sleep(1200);
    return fetchContacts(token, page);
  }
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Bling contatos página ${page} → HTTP ${response.status}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

function digits(value: unknown) {
  const result = String(value ?? "").replace(/\D/g, "");
  return result || null;
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function normalizeContact(row: any, tenantId: string) {
  const id = Number(row?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const address = row?.endereco?.geral ?? row?.endereco ?? {};
  const name = text(row?.nome) ?? text(row?.fantasia) ?? `Cliente Bling ${id}`;
  return {
    tenant_id: tenantId,
    bling_id: id,
    name,
    trade_name: text(row?.fantasia),
    email: text(row?.email)?.toLowerCase() ?? null,
    phone: text(row?.celular) ?? text(row?.telefone) ?? text(row?.fone),
    document: digits(row?.numeroDocumento ?? row?.documento),
    city: text(address?.municipio ?? address?.cidade),
    state: text(address?.uf)?.toUpperCase() ?? null,
    zip_code: digits(address?.cep),
    active: !["I", "INATIVO", "INACTIVE"].includes(String(row?.situacao ?? "").toUpperCase()),
    source: "bling_cutover",
    imported_at: new Date().toISOString(),
    source_payload: row ?? {},
  };
}

export const getBlingCustomerCutoverStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const cfg = await getConfig(context.tenantId);
    const [{ count }, { count: imported }] = await Promise.all([
      (supabaseAdmin as any).from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", context.tenantId),
      (supabaseAdmin as any).from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", context.tenantId).eq("source", "bling_cutover"),
    ]);
    return {
      connected: Boolean(cfg.refresh_token || (cfg.access_token && cfg.expires_at && new Date(cfg.expires_at) > new Date())),
      totalCustomers: count ?? 0,
      importedFromBling: imported ?? 0,
      lastAuthorizedAt: cfg.last_authorized_at ?? null,
    };
  });

export const importBlingCustomersCutover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const token = await accessToken(context.tenantId);
    let page = 1;
    let scanned = 0;
    let inserted = 0;
    let linkedByDocument = 0;
    let alreadyImported = 0;
    let skippedDuplicate = 0;
    const failures: string[] = [];

    while (page <= 500) {
      if (page > 1) await sleep(MIN_INTERVAL_MS);
      const rawRows = await fetchContacts(token, page);
      if (rawRows.length === 0) break;
      const rows = rawRows.map((row: any) => normalizeContact(row, context.tenantId)).filter(Boolean) as any[];
      scanned += rows.length;

      const ids = rows.map((row) => row.bling_id);
      const docs = rows.map((row) => row.document).filter(Boolean);
      const [{ data: byBling }, { data: byDoc }] = await Promise.all([
        (supabaseAdmin as any).from("customers").select("id,bling_id,document").eq("tenant_id", context.tenantId).in("bling_id", ids),
        docs.length
          ? (supabaseAdmin as any).from("customers").select("id,bling_id,document").eq("tenant_id", context.tenantId).in("document", docs)
          : Promise.resolve({ data: [] }),
      ]);
      const existingIds = new Set((byBling ?? []).map((row: any) => Number(row.bling_id)));
      const existingDocs = new Map<string, any>();
      for (const row of byDoc ?? []) if (row.document && !existingDocs.has(String(row.document))) existingDocs.set(String(row.document), row);

      const toInsert: any[] = [];
      for (const row of rows) {
        if (existingIds.has(Number(row.bling_id))) {
          alreadyImported += 1;
          continue;
        }
        if (row.document && existingDocs.has(String(row.document))) {
          const match = existingDocs.get(String(row.document));
          if (!match.bling_id) {
            const { error } = await (supabaseAdmin as any)
              .from("customers")
              .update({ bling_id: row.bling_id, source_payload: row.source_payload, imported_at: row.imported_at })
              .eq("tenant_id", context.tenantId)
              .eq("id", match.id)
              .is("bling_id", null);
            if (error) failures.push(`Documento ${row.document}: ${error.message}`);
            else linkedByDocument += 1;
          } else {
            skippedDuplicate += 1;
          }
          continue;
        }
        toInsert.push(row);
      }

      if (toInsert.length) {
        const { data, error } = await (supabaseAdmin as any).from("customers").insert(toInsert).select("id");
        if (error) {
          failures.push(`Página ${page}: ${error.message}`);
        } else {
          inserted += data?.length ?? toInsert.length;
        }
      }

      if (rawRows.length < PAGE_SIZE) break;
      page += 1;
    }

    await (supabaseAdmin as any).from("bling_sync_logs").insert({
      tenant_id: context.tenantId,
      entity: "cliente",
      action: "one_time_customer_cutover",
      status: failures.length ? "erro" : "sucesso",
      message: `Carteira Bling: ${inserted} inseridos, ${linkedByDocument} vinculados, ${alreadyImported} já existentes, ${skippedDuplicate} duplicados ignorados.`,
      response: { scanned, inserted, linkedByDocument, alreadyImported, skippedDuplicate, failures: failures.slice(0, 20) },
    });

    return { ok: failures.length === 0, scanned, inserted, linkedByDocument, alreadyImported, skippedDuplicate, failures: failures.slice(0, 20) };
  });
