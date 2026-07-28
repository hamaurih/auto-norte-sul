import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tdb } from "@/integrations/supabase/tenant-db";

export type InvitationSummary = {
  id: string;
  email: string;
  organization_role: string;
  tenant_role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireOrganizationAdmin(supabase: ReturnType<typeof tdb>, userId: string) {
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("user_id", userId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: string }) =>
    ["owner", "admin"].includes(item.role),
  );
  if (!membership) throw new Error("Somente proprietário ou administrador da organização");
  return membership as { organization_id: string; role: string };
}

export const listInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = tdb(context.supabase);
    const membership = await requireOrganizationAdmin(supabase, context.userId);
    const { data, error } = await supabase
      .from("tenant_invitations")
      .select("id, email, organization_role, tenant_role, expires_at, accepted_at, revoked_at, created_at")
      .eq("organization_id", membership.organization_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as InvitationSummary[];
  });

export const createInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; organization_role?: string; tenant_role?: string }) => {
    const email = input.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("E-mail inválido");
    return {
      email,
      organization_role: input.organization_role ?? "admin",
      tenant_role: input.tenant_role ?? "admin",
    };
  })
  .handler(async ({ data, context }) => {
    const supabase = tdb(context.supabase);
    const membership = await requireOrganizationAdmin(supabase, context.userId);

    // The clear-text token is returned once to the caller and never persisted
    // nor logged; only its SHA-256 hash is stored.
    const token = randomToken();
    const { data: inserted, error } = await supabase
      .from("tenant_invitations")
      .insert({
        organization_id: membership.organization_id,
        email: data.email,
        organization_role: data.organization_role,
        tenant_role: data.tenant_role,
        token_hash: await hashToken(token),
        created_by: context.userId,
      })
      .select("id, expires_at")
      .single();
    if (error) throw new Error(error.message);

    return { id: inserted.id as string, expires_at: inserted.expires_at as string, token };
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const supabase = tdb(context.supabase);
    const membership = await requireOrganizationAdmin(supabase, context.userId);
    const { error } = await supabase
      .from("tenant_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("organization_id", membership.organization_id)
      .is("accepted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
