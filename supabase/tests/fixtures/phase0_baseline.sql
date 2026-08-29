-- Minimal reproducible Supabase schema for Phase 0 security tests.
-- This fixture intentionally avoids unrelated legacy migrations so the security
-- gate remains deterministic while the historical migration chain is repaired.

create schema if not exists private;

create table public.organizations (
  id uuid primary key,
  slug text not null unique,
  legal_name text not null,
  trade_name text,
  status text not null default 'active'
);

create table public.tenants (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  name text not null,
  slug text not null unique,
  environment text not null,
  status text not null default 'active'
);

create table public.tenant_storefronts (
  tenant_id uuid primary key references public.tenants(id),
  slug text not null unique,
  active boolean not null default true
);

create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references auth.users(id),
  role text not null,
  active boolean not null default true,
  primary key (tenant_id, user_id)
);

create table public.tenant_user_permissions (
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references auth.users(id),
  module_key text not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_update boolean not null default false,
  can_delete boolean not null default false,
  primary key (tenant_id, user_id, module_key)
);

create or replace function private.has_active_tenant_membership(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = (select auth.uid())
      and membership.active
  );
$$;

create or replace function private.has_tenant_role(target_tenant_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = (select auth.uid())
      and membership.active
      and membership.role = any(allowed_roles)
  );
$$;

create or replace function private.has_tenant_module_permission(
  target_tenant_id uuid,
  target_module_key text,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = (select auth.uid())
      and membership.active
      and (
        membership.role in ('owner','admin','manager')
        or (
          membership.role = 'sales'
          and target_action = 'view'
          and target_module_key in ('catalog','crm','sales','inventory')
        )
        or exists (
          select 1
          from public.tenant_user_permissions permission
          where permission.tenant_id = membership.tenant_id
            and permission.user_id = membership.user_id
            and permission.module_key = target_module_key
            and case target_action
              when 'view' then permission.can_view
              when 'create' then permission.can_create
              when 'update' then permission.can_update
              when 'delete' then permission.can_delete
              else false
            end
        )
      )
  );
$$;

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
    (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-tenant-slug'),
    ''
  )
    and storefront.active
    and tenant.status = 'active'
  limit 1;
$$;

revoke all on function private.has_active_tenant_membership(uuid) from public, anon;
revoke all on function private.has_tenant_role(uuid,text[]) from public, anon;
revoke all on function private.has_tenant_module_permission(uuid,text,text) from public, anon;
revoke all on function private.requested_storefront_tenant_id() from public;
grant execute on function private.has_active_tenant_membership(uuid) to authenticated;
grant execute on function private.has_tenant_role(uuid,text[]) to authenticated;
grant execute on function private.has_tenant_module_permission(uuid,text,text) to authenticated;
grant execute on function private.requested_storefront_tenant_id() to anon, authenticated;

create table public.products (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  sku text not null,
  name text not null,
  slug text not null,
  price_b2c numeric(14,2) not null default 0,
  stock integer not null default 0,
  active boolean not null default true,
  hide_when_out_of_stock boolean not null default false,
  featured boolean not null default false
);

create table public.sales_reps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  full_name text,
  email text,
  phone text,
  active boolean not null default true,
  commission_pct numeric(7,4),
  max_discount_pct numeric(7,4),
  can_sell_b2b boolean not null default false,
  can_create_customer boolean not null default false,
  tenant_id uuid not null references public.tenants(id),
  invited_by uuid,
  invited_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_pricing_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  commission_rate numeric(7,4) not null default 0
);

create table public.seller_commission_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  seller_id uuid,
  commission_amount numeric(14,2) not null default 0
);

-- Remaining tenant tables covered by the 80 restrictive module policies.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'branches','brands','categories','customers','order_items','orders',
    'product_applications','product_images','product_stock','quote_items','quotes',
    'sales_orders','sales_rep_customers','stock_movements','stock_reservations',
    'stock_transfer_items','stock_transfers','warehouses'
  ]
  loop
    execute format(
      'create table public.%I (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id))',
      table_name
    );
  end loop;
end
$$;

-- Baseline permissive access for products. The Phase 0 restrictive policies
-- must narrow this access to the row tenant/module permission.
alter table public.products enable row level security;
create policy products_member_read
  on public.products for select to authenticated
  using (
    private.has_active_tenant_membership(tenant_id)
    or tenant_id = private.requested_storefront_tenant_id()
  );
create policy products_member_update
  on public.products for update to authenticated
  using (private.has_active_tenant_membership(tenant_id))
  with check (private.has_active_tenant_membership(tenant_id));

create policy products_public_read
  on public.products for select to anon
  using (
    tenant_id = private.requested_storefront_tenant_id()
    and active
    and (not hide_when_out_of_stock or stock > 0)
  );

-- Management tables used by commission assertions.
alter table public.sales_reps enable row level security;
create policy sales_reps_member_read
  on public.sales_reps for select to authenticated
  using (private.has_active_tenant_membership(tenant_id));

alter table public.product_pricing_settings enable row level security;
create policy product_pricing_settings_select
  on public.product_pricing_settings for select to authenticated
  using (private.has_active_tenant_membership(tenant_id));

alter table public.seller_commission_periods enable row level security;
create policy seller_commission_periods_read
  on public.seller_commission_periods for select to authenticated
  using (private.has_active_tenant_membership(tenant_id));

grant select, insert, update, delete on public.products to authenticated;
grant select on public.sales_reps to authenticated;
grant select on public.product_pricing_settings to authenticated;
grant select on public.seller_commission_periods to authenticated;

-- Create exactly 80 restrictive policies (4 x 20 tables), reproducing the
-- historical permission layer that Phase 0 hardens.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'branches','brands','categories','customers','order_items','orders',
    'product_applications','product_images','product_stock','products',
    'quote_items','quotes','sales_orders','sales_rep_customers','sales_reps',
    'stock_movements','stock_reservations','stock_transfer_items',
    'stock_transfers','warehouses'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy tenant_user_permission_select on public.%I as restrictive for select to authenticated using (true)',
      table_name
    );
    execute format(
      'create policy tenant_user_permission_insert on public.%I as restrictive for insert to authenticated with check (true)',
      table_name
    );
    execute format(
      'create policy tenant_user_permission_update on public.%I as restrictive for update to authenticated using (true) with check (true)',
      table_name
    );
    execute format(
      'create policy tenant_user_permission_delete on public.%I as restrictive for delete to authenticated using (true)',
      table_name
    );
  end loop;
end
$$;

-- SECURITY DEFINER signatures used by the Phase 0 migration. Bodies are
-- intentionally inert; this fixture validates exposure/privilege changes.
create or replace function public.my_access_context() returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create or replace function public.get_inventory_financial_position() returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create or replace function public.get_commercial_intelligence(uuid, integer) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create or replace function public.approve_product_cost_candidates(uuid[]) returns void language plpgsql security definer as $$ begin null; end $$;
create or replace function public.approve_product_enrichment_candidate(uuid) returns void language plpgsql security definer as $$ begin null; end $$;
create or replace function public.close_inventory_period(date) returns void language plpgsql security definer as $$ begin null; end $$;
create or replace function public.confirm_goods_receipt(uuid) returns void language plpgsql security definer as $$ begin null; end $$;
create or replace function public.create_fiscal_draft_from_order(uuid,text) returns void language plpgsql security definer as $$ begin null; end $$;
create or replace function public.create_replenishment_purchase_orders(uuid,uuid,jsonb) returns void language plpgsql security definer as $$ begin null; end $$;
create or replace function public.enqueue_products_for_enrichment(uuid,integer) returns void language plpgsql security definer as $$ begin null; end $$;
create or replace function public.get_commercial_intelligence_v2(uuid,integer) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create or replace function public.get_replenishment_suggestions(uuid,integer) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create or replace function public.get_supplier_performance(uuid,integer) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
create or replace function public.propose_manual_product_cost(uuid,numeric,text,text) returns void language plpgsql security definer as $$ begin null; end $$;
create or replace function public.refresh_cost_sanitation_queue() returns void language plpgsql security definer as $$ begin null; end $$;
create or replace function public.reverse_goods_receipt(uuid,text) returns void language plpgsql security definer as $$ begin null; end $$;

grant execute on all functions in schema public to anon, authenticated, service_role;
