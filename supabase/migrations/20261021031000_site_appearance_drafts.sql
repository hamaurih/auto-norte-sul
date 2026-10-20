CREATE TABLE IF NOT EXISTS public.site_appearance_drafts (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
 draft jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz
);
ALTER TABLE public.site_appearance_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_appearance_drafts FROM anon,authenticated;
COMMENT ON TABLE public.site_appearance_drafts IS 'Unpublished site-only visual settings; publish updates only visual fields on tenant_company_profiles.';

GRANT SELECT,INSERT,UPDATE,DELETE ON public.site_appearance_drafts TO service_role;
