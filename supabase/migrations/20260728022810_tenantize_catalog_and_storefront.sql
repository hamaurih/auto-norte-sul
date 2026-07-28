-- Phase 1B.2: tenant isolation for the public catalog and its core relations.

create table public.tenant_storefronts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  hostname text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

alter table public.tenant_storefronts enable row level security;
create trigger tenant_storefronts_set_updated_at before update on public.tenant_storefronts
for each row execute function private.set_updated_at();

create policy tenant_storefronts_member_read on public.tenant_storefronts
for select to authenticated
using (private.has_tenant_role(tenant_id));
create policy tenant_storefronts_admin_insert on public.tenant_storefronts
for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy tenant_storefronts_admin_update on public.tenant_storefronts
for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (private.has_tenant_role(tenant_id, array['owner', 'admin']));

revoke all on public.tenant_storefronts from anon, authenticated;
grant select, insert, update on public.tenant_storefronts to authenticated;

insert into public.tenant_storefronts (tenant_id, slug, active)
select id, case environment when 'production' then 'norte-sul-real' else 'norte-sul-demo' end, true
from public.tenants
where organization_id = (select id from public.organizations where slug = 'norte-sul-acessorios')
  and environment in ('production', 'demo')
on conflict (tenant_id) do update
set slug = excluded.slug, active = true, updated_at = now();

create or replace function private.requested_storefront_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select storefront.tenant_id
  from public.tenant_storefronts storefront
  join public.tenants tenant on tenant.id = storefront.tenant_id
  where storefront.slug = coalesce(
    nullif(coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-tenant-slug', ''),
    '__missing_storefront__'
  )
    and storefront.active
    and tenant.status = 'active'
  limit 1;
$$;

revoke all on function private.requested_storefront_tenant_id() from public;
grant execute on function private.requested_storefront_tenant_id() to anon, authenticated;

alter table public.brands add column tenant_id uuid;
alter table public.categories add column tenant_id uuid;
alter table public.products add column tenant_id uuid;
alter table public.product_images add column tenant_id uuid;
alter table public.product_applications add column tenant_id uuid;

update public.brands set tenant_id = (
  select id from public.tenants where environment = 'production'
  and organization_id = (select id from public.organizations where slug = 'norte-sul-acessorios')
);
update public.categories set tenant_id = (
  select id from public.tenants where environment = 'production'
  and organization_id = (select id from public.organizations where slug = 'norte-sul-acessorios')
);
update public.products set tenant_id = (
  select id from public.tenants where environment = 'production'
  and organization_id = (select id from public.organizations where slug = 'norte-sul-acessorios')
);
update public.product_images image set tenant_id = product.tenant_id
from public.products product where product.id = image.product_id;
update public.product_applications application set tenant_id = product.tenant_id
from public.products product where product.id = application.product_id;

-- SET NOT NULL below is the transactional backfill guard; it fails if any row is unassigned.


alter table public.brands alter column tenant_id set not null;
alter table public.categories alter column tenant_id set not null;
alter table public.products alter column tenant_id set not null;
alter table public.product_images alter column tenant_id set not null;
alter table public.product_applications alter column tenant_id set not null;

alter table public.brands add constraint brands_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public.categories add constraint categories_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public.products add constraint products_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public.product_images add constraint product_images_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public.product_applications add constraint product_applications_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;

alter table public.brands add constraint brands_id_tenant_key unique (id, tenant_id);
alter table public.categories add constraint categories_id_tenant_key unique (id, tenant_id);
alter table public.products add constraint products_id_tenant_key unique (id, tenant_id);

alter table public.brands drop constraint brands_slug_key;
alter table public.brands add constraint brands_tenant_slug_key unique (tenant_id, slug);

alter table public.categories drop constraint categories_slug_key;
alter table public.categories add constraint categories_tenant_slug_key unique (tenant_id, slug);
alter table public.categories drop constraint categories_parent_id_fkey;
alter table public.categories add constraint categories_parent_tenant_fkey
  foreign key (parent_id, tenant_id) references public.categories(id, tenant_id) on delete restrict;

alter table public.products drop constraint products_sku_key;
alter table public.products drop constraint products_slug_key;
alter table public.products add constraint products_tenant_sku_key unique (tenant_id, sku);
alter table public.products add constraint products_tenant_slug_key unique (tenant_id, slug);

alter table public.products drop constraint products_brand_id_fkey;
alter table public.products add constraint products_brand_tenant_fkey
  foreign key (brand_id, tenant_id) references public.brands(id, tenant_id) on delete restrict;
alter table public.products drop constraint products_category_id_fkey;
alter table public.products add constraint products_category_tenant_fkey
  foreign key (category_id, tenant_id) references public.categories(id, tenant_id) on delete restrict;
alter table public.products drop constraint products_subcategory_id_fkey;
alter table public.products add constraint products_subcategory_tenant_fkey
  foreign key (subcategory_id, tenant_id) references public.categories(id, tenant_id) on delete restrict;

alter table public.product_images drop constraint product_images_product_id_fkey;
alter table public.product_images add constraint product_images_product_tenant_fkey
  foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade;
alter table public.product_applications drop constraint product_applications_product_id_fkey;
alter table public.product_applications add constraint product_applications_product_tenant_fkey
  foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade;

create index brands_tenant_featured_idx on public.brands (tenant_id, featured, name);
create index categories_tenant_active_sort_idx on public.categories (tenant_id, active, sort_order);
create index categories_parent_tenant_idx on public.categories (parent_id, tenant_id) where parent_id is not null;
create index products_tenant_active_idx on public.products (tenant_id, active, name);
create index products_tenant_brand_idx on public.products (tenant_id, brand_id) where brand_id is not null;
create index products_tenant_category_idx on public.products (tenant_id, category_id) where category_id is not null;
create index products_tenant_subcategory_idx on public.products (tenant_id, subcategory_id) where subcategory_id is not null;
create index product_images_tenant_product_idx on public.product_images (tenant_id, product_id, is_primary desc, sort_order);
create index product_applications_tenant_product_idx on public.product_applications (tenant_id, product_id);

-- Replace every legacy catalog policy so no global staff role can cross tenants.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('brands','categories','products','product_images','product_applications')
  loop
    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end;
$$;

create policy brands_storefront_read on public.brands
for select to anon
using (tenant_id = private.requested_storefront_tenant_id());
create policy brands_member_read on public.brands
for select to authenticated
using (tenant_id = private.requested_storefront_tenant_id() or private.has_tenant_role(tenant_id));
create policy brands_member_insert on public.brands
for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy brands_member_update on public.brands
for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy brands_member_delete on public.brands
for delete to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

create policy categories_storefront_read on public.categories
for select to anon
using (tenant_id = private.requested_storefront_tenant_id() and active);
create policy categories_member_read on public.categories
for select to authenticated
using ((tenant_id = private.requested_storefront_tenant_id() and active) or private.has_tenant_role(tenant_id));
create policy categories_member_insert on public.categories
for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy categories_member_update on public.categories
for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy categories_member_delete on public.categories
for delete to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

create policy products_storefront_read on public.products
for select to anon
using (
  tenant_id = private.requested_storefront_tenant_id()
  and active and (stock > 0 or not hide_when_out_of_stock)
);
create policy products_member_read on public.products
for select to authenticated
using (
  (tenant_id = private.requested_storefront_tenant_id() and active and (stock > 0 or not hide_when_out_of_stock))
  or private.has_tenant_role(tenant_id)
);
create policy products_member_insert on public.products
for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy products_member_update on public.products
for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy products_member_delete on public.products
for delete to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

create policy product_images_storefront_read on public.product_images
for select to anon
using (tenant_id = private.requested_storefront_tenant_id());
create policy product_images_member_read on public.product_images
for select to authenticated
using (tenant_id = private.requested_storefront_tenant_id() or private.has_tenant_role(tenant_id));
create policy product_images_member_insert on public.product_images
for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy product_images_member_update on public.product_images
for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy product_images_member_delete on public.product_images
for delete to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));

create policy product_applications_storefront_read on public.product_applications
for select to anon
using (tenant_id = private.requested_storefront_tenant_id());
create policy product_applications_member_read on public.product_applications
for select to authenticated
using (tenant_id = private.requested_storefront_tenant_id() or private.has_tenant_role(tenant_id));
create policy product_applications_member_insert on public.product_applications
for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy product_applications_member_update on public.product_applications
for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));
create policy product_applications_member_delete on public.product_applications
for delete to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));

revoke all on public.brands, public.categories, public.products,
  public.product_images, public.product_applications from anon, authenticated;
grant select on public.brands, public.categories, public.products,
  public.product_images, public.product_applications to anon;
grant select, insert, update, delete on public.brands, public.categories, public.products,
  public.product_images, public.product_applications to authenticated;
revoke select (price_b2b, internal_code) on public.products from anon;

comment on table public.tenant_storefronts is 'Maps a public storefront slug or hostname to one isolated tenant.';
comment on function private.requested_storefront_tenant_id() is 'Resolves x-tenant-slug from the Data API request to an active storefront tenant.';
