import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb, type TenantDb } from "@/integrations/supabase/tenant-db";
import { requireTenantRole } from "@/lib/auth-guards";

const accountIdSchema = z.object({ customer_id: z.string().uuid() });
const accessSchema = accountIdSchema.extend({ active: z.boolean() });

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return tdb(supabaseAdmin);
}

async function requireStorefrontAdmin(sb: TenantDb, userId: string, tenantId: string) {
  await requireTenantRole(sb, userId, tenantId, ["owner", "admin"]);
}

async function customerAccount(sb: TenantDb, tenantId: string, customerId: string) {
  const { data, error } = await sb
    .from("customers")
    .select("id, user_id, name, email, active")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.user_id || !data.email) throw new Error("Esta ficha não possui uma conta de acesso do site.");
  const { data: membership, error: membershipError } = await sb
    .from("tenant_memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", data.user_id)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (membership) throw new Error("Esta é uma conta interna. Use Usuários do sistema para gerenciá-la.");
  return data as { id: string; user_id: string; name: string; email: string; active: boolean };
}

export const listStorefrontAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await admin();
    await requireStorefrontAdmin(sb, context.userId, context.tenantId);
    const { data, error } = await sb
      .from("customers")
      .select("id, user_id, name, email, phone, active, created_at, updated_at")
      .eq("tenant_id", context.tenantId)
      .not("user_id", "is", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const accounts = [] as Array<Record<string, unknown>>;
    for (const customer of data ?? []) {
      const { data: userResult, error: userError } = await sb.auth.admin.getUserById(customer.user_id as string);
      if (userError || !userResult.user) continue;
      const user = userResult.user;
      accounts.push({
        ...customer,
        email: user.email ?? customer.email,
        created_at: user.created_at ?? customer.created_at,
        last_sign_in_at: user.last_sign_in_at ?? null,
        banned_until: user.banned_until ?? null,
        active: Boolean(customer.active) && !user.banned_until,
      });
    }
    return accounts;
  });

export const setStorefrontAccountAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => accessSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    await requireStorefrontAdmin(sb, context.userId, context.tenantId);
    const account = await customerAccount(sb, context.tenantId, data.customer_id);
    const { error: authError } = await sb.auth.admin.updateUserById(account.user_id, {
      ban_duration: data.active ? "none" : "876000h",
    } as any);
    if (authError) throw new Error(authError.message);
    const { error: customerError } = await sb
      .from("customers")
      .update({ active: data.active })
      .eq("id", account.id)
      .eq("tenant_id", context.tenantId);
    if (customerError) throw new Error(customerError.message);
    return { ok: true };
  });

export const sendStorefrontPasswordRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => accountIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    await requireStorefrontAdmin(sb, context.userId, context.tenantId);
    const account = await customerAccount(sb, context.tenantId, data.customer_id);
    const { error } = await sb.auth.resetPasswordForEmail(account.email, {
      redirectTo: "https://www.nortesulauto.com.br/redefinir-senha",
    });
    if (error) throw new Error(error.message);
    return { ok: true, email: account.email };
  });
