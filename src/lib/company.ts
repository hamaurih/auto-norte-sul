import { useQuery } from "@tanstack/react-query";
import { tdb } from "@/integrations/supabase/tenant-db";
import { activeTenantSlug, supabase } from "@/integrations/supabase/client";

export type CompanyProfile = {
  tenant_id: string;
  legal_name: string | null;
  trade_name: string;
  tax_id: string | null;
  state_registration: string | null;
  municipal_registration: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  address_zip: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  logo_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  store_title: string | null;
  store_description: string | null;
  footer_text: string | null;
  business_hours: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  youtube_url: string | null;
};

export async function fetchCompanyProfile(): Promise<CompanyProfile | null> {
  const { data: storefront, error: storefrontError } = await tdb(supabase)
    .from("tenant_storefronts")
    .select("tenant_id")
    .eq("slug", activeTenantSlug())
    .eq("active", true)
    .maybeSingle();
  if (storefrontError) throw new Error(storefrontError.message);
  if (!storefront) return null;

  const { data, error } = await tdb(supabase)
    .from("tenant_company_profiles")
    .select("*")
    .eq("tenant_id", storefront.tenant_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as CompanyProfile | null;
}

export function useCompanyProfile() {
  return useQuery({
    queryKey: ["company-profile"],
    queryFn: fetchCompanyProfile,
    staleTime: 60_000,
  });
}
