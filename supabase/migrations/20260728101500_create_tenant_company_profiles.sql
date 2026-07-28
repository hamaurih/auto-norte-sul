begin;

create table public.tenant_company_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  legal_name text,
  trade_name text not null,
  tax_id text,
  state_registration text,
  municipal_registration text,
  email text,
  phone text,
  whatsapp text,
  website text,
  address_zip text,
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_state char(2),
  country_code char(2) not null default 'BR',
  logo_url text,
  logo_dark_url text,
  favicon_url text,
  primary_color text not null default '#c8102e'
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#171923'
    check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#f59e0b'
    check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  store_title text,
  store_description text,
  footer_text text,
  business_hours text,
  instagram_url text,
  facebook_url text,
  youtube_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint tenant_company_profiles_tax_id_check
    check (tax_id is null or length(regexp_replace(tax_id, '[^0-9]', '', 'g')) in (11, 14))
);

create index tenant_company_profiles_updated_by_idx
  on public.tenant_company_profiles (updated_by);

alter table public.tenant_company_profiles enable row level security;
revoke all on table public.tenant_company_profiles from public;
grant select on table public.tenant_company_profiles to anon, authenticated;
grant insert, update on table public.tenant_company_profiles to authenticated;
grant all on table public.tenant_company_profiles to service_role;

create policy company_profile_storefront_read
on public.tenant_company_profiles for select to anon, authenticated
using (
  tenant_id = private.requested_storefront_tenant_id()
  or private.has_tenant_role(
    tenant_id,
    array['owner', 'admin', 'manager']::text[]
  )
);

create policy company_profile_tenant_admin_insert
on public.tenant_company_profiles for insert to authenticated
with check (
  private.has_tenant_role(tenant_id, array['owner', 'admin']::text[])
  and updated_by = (select auth.uid())
);

create policy company_profile_tenant_admin_update
on public.tenant_company_profiles for update to authenticated
using (
  private.has_tenant_role(tenant_id, array['owner', 'admin']::text[])
)
with check (
  private.has_tenant_role(tenant_id, array['owner', 'admin']::text[])
  and updated_by = (select auth.uid())
);

insert into public.tenant_company_profiles (
  tenant_id, trade_name, store_title, store_description, footer_text
)
select
  tenant.id,
  tenant.name,
  tenant.name || ' · Loja e Atacado Automotivo',
  'Som, iluminação, performance, segurança e acessórios automotivos.',
  'Todos os direitos reservados.'
from public.tenants tenant
on conflict (tenant_id) do nothing;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'tenant-branding',
  'tenant-branding',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/x-icon']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy tenant_branding_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'tenant-branding'
  and exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.tenant_id::text = (storage.foldername(name))[1]
      and membership.active
      and membership.role in ('owner', 'admin')
  )
);

create policy tenant_branding_admin_select
on storage.objects for select to authenticated
using (
  bucket_id = 'tenant-branding'
  and exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.tenant_id::text = (storage.foldername(name))[1]
      and membership.active
      and membership.role in ('owner', 'admin')
  )
);

create policy tenant_branding_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'tenant-branding'
  and exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.tenant_id::text = (storage.foldername(name))[1]
      and membership.active
      and membership.role in ('owner', 'admin')
  )
)
with check (
  bucket_id = 'tenant-branding'
  and exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.tenant_id::text = (storage.foldername(name))[1]
      and membership.active
      and membership.role in ('owner', 'admin')
  )
);

create policy tenant_branding_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'tenant-branding'
  and exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.tenant_id::text = (storage.foldername(name))[1]
      and membership.active
      and membership.role in ('owner', 'admin')
  )
);

commit;
