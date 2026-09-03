import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireTenantRole } from "@/lib/auth-guards";
import { encryptIntegrationSecret } from "@/lib/integration-crypto.server";

type IntegrationStatus = "disconnected" | "connected" | "error" | "configuring";

type IntegrationDefinition = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
};

async function assertIntegrationAdmin(sb: any, userId: string, tenantId: string) {
  await requireTenantRole(sb, userId, tenantId, ["owner", "admin"]);
}

async function getTenantIntegration(sb: any, tenantId: string, integrationId: string) {
  const { data, error } = await sb
    .from("tenant_integration_states")
    .select("id,tenant_id,integration_id,status,active,last_sync_at")
    .eq("tenant_id", tenantId)
    .eq("integration_id", integrationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Integração não disponível neste ambiente.");
  return data;
}

async function getDefinition(
  sb: any,
  tenantId: string,
  integrationId: string,
): Promise<IntegrationDefinition> {
  await getTenantIntegration(sb, tenantId, integrationId);
  const { data, error } = await sb
    .from("integrations")
    .select("id,name,slug,description,category")
    .eq("id", integrationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Integração não encontrada.");
  return data as IntegrationDefinition;
}

export const listIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);

    const [{ data: definitions, error: definitionError }, { data: states, error: stateError }] =
      await Promise.all([
        sb
          .from("integrations")
          .select("id,name,slug,description,category")
          .order("category")
          .order("name"),
        sb
          .from("tenant_integration_states")
          .select("integration_id,status,active,last_sync_at")
          .eq("tenant_id", context.tenantId),
      ]);

    if (definitionError) throw new Error(definitionError.message);
    if (stateError) throw new Error(stateError.message);

    const stateByIntegration = new Map(
      (states ?? []).map((state: any) => [state.integration_id, state]),
    );

    return (definitions ?? []).flatMap((definition: IntegrationDefinition) => {
      const state = stateByIntegration.get(definition.id);
      if (!state) return [];
      return [
        {
          ...definition,
          status: state.status as IntegrationStatus,
          active: Boolean(state.active),
          last_sync_at: state.last_sync_at ?? null,
        },
      ];
    });
  });

export const getIntegrationBySlug = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { slug: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);

    const { data: definition, error } = await sb
      .from("integrations")
      .select("id,name,slug,description,category")
      .eq("slug", data.slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!definition) return null;

    const state = await getTenantIntegration(sb, context.tenantId, definition.id);
    return {
      ...definition,
      status: state.status as IntegrationStatus,
      active: Boolean(state.active),
      last_sync_at: state.last_sync_at ?? null,
    };
  });

export const listIntegrationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { integration_id: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);
    await getDefinition(sb, context.tenantId, data.integration_id);

    const { data: rows, error } = await sb
      .from("integration_settings")
      .select("id,integration_id,key,value_encrypted,is_secret,updated_at")
      .eq("tenant_id", context.tenantId)
      .eq("integration_id", data.integration_id)
      .order("key");
    if (error) throw new Error(error.message);

    // Secret values never leave the server. The UI only receives configured=true.
    return (rows ?? []).map((row: any) => ({
      id: row.id,
      integration_id: row.integration_id,
      key: row.key,
      value_encrypted: row.is_secret ? null : row.value_encrypted,
      is_secret: Boolean(row.is_secret),
      configured: Boolean(row.value_encrypted),
      updated_at: row.updated_at,
    }));
  });

export const listIntegrationLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { integration_id: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);
    await getDefinition(sb, context.tenantId, data.integration_id);

    const { data: rows, error } = await sb
      .from("integration_logs")
      .select("id,event_type,status,message,created_at")
      .eq("tenant_id", context.tenantId)
      .eq("integration_id", data.integration_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const integrationSetStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; status: IntegrationStatus }) => i)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);
    await getDefinition(sb, context.tenantId, data.id);

    const { error } = await sb
      .from("tenant_integration_states")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("integration_id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const integrationToggleActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; active: boolean }) => i)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);
    await getDefinition(sb, context.tenantId, data.id);

    const { error } = await sb
      .from("tenant_integration_states")
      .update({ active: data.active, updated_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("integration_id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const integrationSaveSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { integration_id: string; key: string; value: string; is_secret?: boolean }) => {
      const value = String(i.value ?? "").trim();
      const key = String(i.key ?? "").trim();
      if (!key || key.length > 120) throw new Error("Parâmetro de integração inválido.");
      if (!value || value.length > 100_000) throw new Error("Informe um valor válido.");
      return { ...i, key, value };
    },
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);
    await getDefinition(sb, context.tenantId, data.integration_id);

    const { data: current, error: currentError } = await sb
      .from("integration_settings")
      .select("is_secret")
      .eq("tenant_id", context.tenantId)
      .eq("integration_id", data.integration_id)
      .eq("key", data.key)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);

    // Once a key is secret it cannot be downgraded to a readable setting.
    const isSecret = Boolean(current?.is_secret || data.is_secret);
    const storedValue = isSecret
      ? await encryptIntegrationSecret(data.value)
      : data.value;

    const { error } = await sb
      .from("integration_settings")
      .upsert(
        {
          tenant_id: context.tenantId,
          integration_id: data.integration_id,
          key: data.key,
          value_encrypted: storedValue,
          is_secret: isSecret,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,integration_id,key" },
      );
    if (error) throw new Error(error.message);

    const state = await getTenantIntegration(sb, context.tenantId, data.integration_id);
    if (state.status !== "connected") {
      await sb
        .from("tenant_integration_states")
        .update({ status: "configuring", updated_at: new Date().toISOString() })
        .eq("tenant_id", context.tenantId)
        .eq("integration_id", data.integration_id);
    }

    await sb.from("integration_logs").insert({
      tenant_id: context.tenantId,
      integration_id: data.integration_id,
      event_type: "configuration_saved",
      status: "success",
      message: `Parâmetro "${data.key}" salvo com proteção no ambiente atual.`,
    });

    return { ok: true, is_secret: isSecret };
  });

export const integrationTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; slug: string }) => i)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);
    const definition = await getDefinition(sb, context.tenantId, data.id);

    if (definition.slug === "stone") {
      const { configureStoneWebhook } = await import("@/lib/stone-conciliation.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      try {
        const result = await configureStoneWebhook(supabaseAdmin as any, context.tenantId);
        await sb
          .from("tenant_integration_states")
          .update({
            status: "connected",
            active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", context.tenantId)
          .eq("integration_id", data.id);
        await sb.from("integration_logs").insert({
          tenant_id: context.tenantId,
          integration_id: data.id,
          event_type: "stone_webhook_configured",
          status: "success",
          message: "Chave validada e webhook de conciliação Pix atualizado na Stone.",
          payload: { webhook_url: result.webhookUrl },
        });
        return { ok: true, message: "Stone conectada e webhook Pix configurado." };
      } catch (cause: any) {
        const message = String(cause?.message ?? cause).slice(0, 500);
        await sb.from("integration_logs").insert({
          tenant_id: context.tenantId,
          integration_id: data.id,
          event_type: "stone_connection_failed",
          status: "error",
          message,
        });
        throw new Error(message);
      }
    }

    const { data: settings, error } = await sb
      .from("integration_settings")
      .select("key,value_encrypted")
      .eq("tenant_id", context.tenantId)
      .eq("integration_id", data.id);
    if (error) throw new Error(error.message);

    const configured = (settings ?? []).filter((setting: any) => Boolean(setting.value_encrypted)).length;
    const message =
      configured > 0
        ? `Teste de conexão para ${definition.name} registrado. O adaptador oficial será executado quando as credenciais OAuth/API estiverem habilitadas.`
        : `Teste de conexão para ${definition.name} registrado, mas faltam credenciais neste ambiente.`;

    const { error: logError } = await sb.from("integration_logs").insert({
      tenant_id: context.tenantId,
      integration_id: data.id,
      event_type: "test_connection",
      status: configured > 0 ? "pending" : "warning",
      message,
      payload: { slug: definition.slug, configured_parameters: configured },
    });
    if (logError) throw new Error(logError.message);

    return { ok: true, message };
  });

export const integrationRunSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; slug: string; scope?: string }) => i)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);
    const definition = await getDefinition(sb, context.tenantId, data.id);

    const scope = String(data.scope ?? "manual").slice(0, 80);
    if (definition.slug === "stone") {
      const { processStonePixInbox, requestStonePixFile } = await import(
        "@/lib/stone-conciliation.server"
      );
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (scope === "solicitar-pix-ontem") {
        const referenceDate = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", {
          timeZone: "America/Sao_Paulo",
        });
        await requestStonePixFile(supabaseAdmin as any, context.tenantId, referenceDate);
        await sb.from("integration_logs").insert({
          tenant_id: context.tenantId,
          integration_id: data.id,
          event_type: "stone_pix_requested",
          status: "pending",
          message: `Arquivo Pix de ${referenceDate} solicitado. A Stone o enviará ao webhook em até 30 minutos.`,
          payload: { reference_date: referenceDate },
        });
        return { ok: true };
      }
      if (scope === "processar-pix") {
        const result = await processStonePixInbox(supabaseAdmin as any, context.tenantId);
        await sb.from("integration_logs").insert({
          tenant_id: context.tenantId,
          integration_id: data.id,
          event_type: "stone_pix_imported",
          status: "success",
          message: `${result.files} arquivo(s) processado(s), ${result.imported} linha(s) conciliada(s).`,
          payload: result,
        });
        await sb
          .from("tenant_integration_states")
          .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("tenant_id", context.tenantId)
          .eq("integration_id", data.id);
        return { ok: true };
      }
      throw new Error("Ação de conciliação Stone inválida.");
    }

    const { error: logError } = await sb.from("integration_logs").insert({
      tenant_id: context.tenantId,
      integration_id: data.id,
      event_type: `sync_${scope}`,
      status: "pending",
      message: `Sincronização (${scope}) enfileirada para ${definition.name}. O conector será ativado após a autorização do provedor.`,
    });
    if (logError) throw new Error(logError.message);
    return { ok: true };
  });

export const integrationRetryLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { log_id: string }) => i)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await assertIntegrationAdmin(sb, context.userId, context.tenantId);

    const { data: log, error } = await sb
      .from("integration_logs")
      .select("integration_id,event_type,payload")
      .eq("id", data.log_id)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!log) throw new Error("Log não encontrado neste ambiente.");

    const { error: insertError } = await sb.from("integration_logs").insert({
      tenant_id: context.tenantId,
      integration_id: log.integration_id,
      event_type: `${log.event_type}:retry`,
      status: "pending",
      message: "Reprocessamento solicitado.",
      payload: log.payload,
    });
    if (insertError) throw new Error(insertError.message);
    return { ok: true };
  });
