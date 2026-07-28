/**
 * Sales rep management server functions.
 * Admin/gerente can create sales reps; invitation goes out via Supabase Auth.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tdb } from "@/integrations/supabase/tenant-db";

export const inviteSalesRep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { full_name: string; email: string; phone?: string; commission_pct?: number; notes?: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase: rawSupabase, userId } = context;
    const supabase = tdb(rawSupabase);

    const { data: memberships, error: membershipError } = await supabase
      .from("tenant_memberships")
      .select("tenant_id, role")
      .eq("user_id", userId)
      .eq("tenant_id", context.tenantId)
      .eq("active", true);
    if (membershipError) throw new Error(membershipError.message);
    const membership = (memberships ?? []).find((item: { role: string }) =>
      ["owner", "admin", "manager"].includes(item.role),
    );
    if (!membership) throw new Error("Usuário sem permissão para convidar vendedor");

    const { supabaseAdmin: rawSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = tdb(rawSupabaseAdmin);

    // Send invite email (creates auth user if new)
    const redirectTo = process.env.SITE_URL ? `${process.env.SITE_URL}/auth` : undefined;
    const { data: invited, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.full_name, role: "vendedor" },
      redirectTo,
    });
    if (invErr && !/already/i.test(invErr.message)) throw new Error(invErr.message);

    // Find or reuse user id
    let newUserId = invited?.user?.id ?? null;
    if (!newUserId) {
      const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
      newUserId = existing?.users.find((u: { email?: string }) => u.email?.toLowerCase() === data.email.toLowerCase())?.id ?? null;
    }
    if (!newUserId) throw new Error("Não foi possível criar o usuário");

    // Keep the legacy role during the transition and grant tenant-scoped access.
    await supabaseAdmin.from("user_roles").upsert(
      { user_id: newUserId, role: "vendedor" },
      { onConflict: "user_id,role" },
    );
    const { error: tenantRoleError } = await supabaseAdmin.from("tenant_memberships").upsert(
      {
        tenant_id: membership.tenant_id,
        user_id: newUserId,
        role: "sales",
        active: true,
      },
      { onConflict: "tenant_id,user_id" },
    );
    if (tenantRoleError) throw new Error(tenantRoleError.message);

    // Insert sales_reps row
    const { data: rep, error: repErr } = await supabaseAdmin
      .from("sales_reps")
      .upsert(
        {
          tenant_id: membership.tenant_id,
          user_id: newUserId,
          full_name: data.full_name,
          email: data.email.toLowerCase(),
          phone: data.phone ?? null,
          commission_pct: data.commission_pct ?? 0,
          notes: data.notes ?? null,
          invited_by: userId,
        },
        { onConflict: "tenant_id,email" },
      )
      .select()
      .single();
    if (repErr) throw new Error(repErr.message);

    return { ok: true, rep };
  });
