begin;

-- Public storefront resolution: anonymous visitors may only see the active
-- storefront selected by the x-tenant-slug header already sent by the client.
grant select on table public.tenant_storefronts to anon;
drop policy if exists tenant_storefronts_public_read_active on public.tenant_storefronts;
drop policy if exists tenant_storefronts_public_read on public.tenant_storefronts;
create policy tenant_storefronts_public_read
on public.tenant_storefronts
for select
to anon
using (
  active
  and slug = nullif(
    coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-tenant-slug',
    ''
  )
);

-- The previous company-profile policy served anon and authenticated together
-- and invoked private.has_tenant_role(). Anonymous visitors intentionally
-- cannot execute that helper, so the storefront could not load saved branding.
revoke all on table public.tenant_company_profiles from anon;
grant select on table public.tenant_company_profiles to anon;

drop policy if exists company_profile_storefront_read on public.tenant_company_profiles;
drop policy if exists company_profile_storefront_public_read on public.tenant_company_profiles;
drop policy if exists company_profile_storefront_member_read on public.tenant_company_profiles;

create policy company_profile_storefront_public_read
on public.tenant_company_profiles
for select
to anon
using (
  tenant_id = private.requested_storefront_tenant_id()
);

create policy company_profile_storefront_member_read
on public.tenant_company_profiles
for select
to authenticated
using (
  tenant_id = private.requested_storefront_tenant_id()
  or private.has_tenant_role(
    tenant_id,
    array['owner', 'admin', 'manager']::text[]
  )
);

commit;
