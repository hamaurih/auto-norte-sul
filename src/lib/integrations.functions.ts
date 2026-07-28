import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

export const integrationSetStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; status: "disconnected" | "connected" | "error" | "configuring" }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await (context.supabase as any).from("integrations").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const integrationToggleActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; active: boolean }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await (context.supabase as any).from("integrations").update({ active: data.active }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const integrationSaveSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { integration_id: string; key: string; value: string; is_secret?: boolean }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await (context.supabase as any)
      .from("integration_settings")
      .upsert(
        { integration_id: data.integration_id, key: data.key, value_encrypted: data.value, is_secret: data.is_secret ?? false },
        { onConflict: "integration_id,key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const integrationTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; slug: string }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // Stub: real per-provider health-check goes here. Records a log entry.
    const message = `Teste de conexão para ${data.slug} — módulo em preparação. Aguardando credenciais/OAuth.`;
    await (context.supabase as any).from("integration_logs").insert({
      integration_id: data.id,
      event_type: "test_connection",
      status: "pending",
      message,
    });
    return { ok: true, message };
  });

export const integrationRunSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; slug: string; scope?: string }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await (context.supabase as any).from("integration_logs").insert({
      integration_id: data.id,
      event_type: `sync_${data.scope ?? "manual"}`,
      status: "pending",
      message: `Sincronização (${data.scope ?? "manual"}) enfileirada para ${data.slug}.`,
    });
    await (context.supabase as any).from("integrations").update({ last_sync_at: new Date().toISOString() }).eq("id", data.id);
    return { ok: true };
  });

export const integrationRetryLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { log_id: string }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: log, error } = await (context.supabase as any)
      .from("integration_logs")
      .select("integration_id,event_type,payload")
      .eq("id", data.log_id)
      .single();
    if (error || !log) throw new Error(error?.message ?? "Log não encontrado");
    await (context.supabase as any).from("integration_logs").insert({
      integration_id: log.integration_id,
      event_type: `${log.event_type}:retry`,
      status: "pending",
      message: "Reprocessamento solicitado.",
      payload: log.payload,
    });
    return { ok: true };
  });
