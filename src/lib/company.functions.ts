import { createServerFn } from "@tanstack/react-start";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CompanyProfile } from "./company";

export type CompanyProfileInput = Omit<CompanyProfile, "tenant_id">;

export const saveCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CompanyProfileInput) => input)
  .handler(async ({ data, context }) => {
    const { supabase: rawSupabase, tenantId, userId } = context;
    const supabase = tdb(rawSupabase);
    const { data: membership, error: membershipError } = await supabase
      .from("tenant_memberships")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Apenas proprietário ou administrador pode alterar a empresa");
    }

    const { error } = await supabase.from("tenant_company_profiles").upsert({
      ...data,
      tenant_id: tenantId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true, tenantId };
  });
