-- Granular permissions for internal users, scoped to the active tenant.
-- Existing memberships keep their role defaults until an explicit override is saved.

create table if not exists public.tenant_user_permissions (
  tenant_id uuid not null,
  user_id uuid not null,
  module_key text not null check (module_key in (
    'dashboard', 'sales', 'crm', 'catalog', 'inventory', 'purchasing',
    'marketing', 'integrations', 'ai', 'reports', 'fiscal', 'users',
    'settings', 'audit'
  )),
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_update boolean not null default false,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, module_key),
  constraint tenant_user_permissions_membership_fkey
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade
);

create index if not exists tenant_user_permissions_user_idx
  on public.tenant_user_permissions (user_id, tenant_id);

alter table public.tenant_user_permissions enable row level security;

drop trigger if exists tenant_user_permissions_set_updated_at
  on public.tenant_user_permissions;
create trigger tenant_user_permissions_set_updated_at
before update on public.tenant_user_permissions
for each row execute function private.set_updated_at();

revoke all on table public.tenant_user_permissions from anon, authenticated;
grant select on table public.tenant_user_permissions to authenticated;
grant all on table public.tenant_user_permissions to service_role;

drop policy if exists tenant_user_permissions_self_read
  on public.tenant_user_permissions;
create policy tenant_user_permissions_self_read
on public.tenant_user_permissions
for select to authenticated
using (
  user_id = (select auth.uid())
  or private.has_tenant_role(tenant_id, array['owner', 'admin'])
);

create or replace function private.has_tenant_module_permission(
  target_tenant_id uuid,
  target_module_key text,
  target_action text default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with membership as (
    select role
    from public.tenant_memberships
    where tenant_id = target_tenant_id
      and user_id = (select auth.uid())
      and active
    limit 1
  ),
  role_default as (
    select case
      when target_action = 'view' then
        case
          when role in ('owner', 'admin') then true
          when role = 'manager' then target_module_key <> 'users'
          when role = 'sales' then target_module_key in ('dashboard', 'sales', 'crm', 'catalog', 'inventory', 'reports')
          when role = 'cashier' then target_module_key in ('dashboard', 'sales', 'crm', 'reports')
          when role = 'stock' then target_module_key in ('dashboard', 'catalog', 'inventory', 'purchasing', 'reports')
          when role in ('finance', 'accountant') then target_module_key in ('dashboard', 'sales', 'fiscal', 'reports')
          when role = 'support' then target_module_key in ('dashboard', 'sales', 'crm', 'catalog')
          else false
        end
      when target_action in ('create', 'update') then
        case
          when role in ('owner', 'admin') then target_module_key not in ('users', 'audit')
          when role = 'manager' then target_module_key not in ('users', 'audit')
          when role in ('sales', 'cashier') then target_module_key in ('sales', 'crm')
          when role = 'stock' then target_module_key in ('catalog', 'inventory', 'purchasing')
          when role in ('finance', 'accountant') then target_module_key in ('sales', 'fiscal')
          when role = 'support' then target_module_key in ('sales', 'crm')
          else false
        end
      when target_action = 'delete' then role in ('owner', 'admin')
      else false
    end as allowed
    from membership
  ),
  override as (
    select case target_action
      when 'view' then can_view
      when 'create' then can_create
      when 'update' then can_update
      when 'delete' then can_delete
      else false
    end as allowed
    from public.tenant_user_permissions
    where tenant_id = target_tenant_id
      and user_id = (select auth.uid())
      and module_key = target_module_key
    limit 1
  )
  select coalesce((select allowed from override), (select allowed from role_default), false);
$$;

revoke all on function private.has_tenant_module_permission(uuid, text, text) from public;
grant execute on function private.has_tenant_module_permission(uuid, text, text) to authenticated;

-- Defense in depth: hide tenant records at the data layer when a staff member
-- manually opens a URL that the sidebar does not expose.
do $policies$
declare
  item record;
begin
  for item in
    select * from (values
      ('brands', 'catalog'),
      ('categories', 'catalog'),
      ('products', 'catalog'),
      ('product_images', 'catalog'),
      ('product_applications', 'catalog'),
      ('branches', 'inventory'),
      ('warehouses', 'inventory'),
      ('product_stock', 'inventory'),
      ('stock_movements', 'inventory'),
      ('stock_transfers', 'inventory'),
      ('stock_transfer_items', 'inventory'),
      ('customers', 'crm'),
      ('sales_reps', 'sales'),
      ('sales_rep_customers', 'sales'),
      ('sales_orders', 'sales'),
      ('quotes', 'sales'),
      ('quote_items', 'sales'),
      ('orders', 'sales'),
      ('order_items', 'sales'),
      ('stock_reservations', 'sales')
    ) as modules(table_name, module_key)
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = item.table_name
        and column_name = 'tenant_id'
    ) then
      execute format($sql$
        drop policy if exists %I on public.%I;
        create policy %I on public.%I
        as restrictive for select to authenticated
        using (
          not exists (
            select 1
            from public.tenant_memberships membership
            where membership.tenant_id = %I.tenant_id
              and membership.user_id = (select auth.uid())
              and membership.active
          )
          or private.has_tenant_module_permission(%I.tenant_id, %L, 'view')
        );
      $sql$,
        'tenant_user_permission_select', item.table_name,
        'tenant_user_permission_select', item.table_name,
        item.table_name, item.table_name, item.module_key
      );

      execute format($sql$
        drop policy if exists %I on public.%I;
        create policy %I on public.%I
        as restrictive for insert to authenticated
        with check (
          not exists (
            select 1
            from public.tenant_memberships membership
            where membership.tenant_id = %I.tenant_id
              and membership.user_id = (select auth.uid())
              and membership.active
          )
          or private.has_tenant_module_permission(%I.tenant_id, %L, 'create')
        );
      $sql$,
        'tenant_user_permission_insert', item.table_name,
        'tenant_user_permission_insert', item.table_name,
        item.table_name, item.table_name, item.module_key
      );

      execute format($sql$
        drop policy if exists %I on public.%I;
        create policy %I on public.%I
        as restrictive for update to authenticated
        using (
          not exists (
            select 1
            from public.tenant_memberships membership
            where membership.tenant_id = %I.tenant_id
              and membership.user_id = (select auth.uid())
              and membership.active
          )
          or private.has_tenant_module_permission(%I.tenant_id, %L, 'update')
        )
        with check (
          not exists (
            select 1
            from public.tenant_memberships membership
            where membership.tenant_id = %I.tenant_id
              and membership.user_id = (select auth.uid())
              and membership.active
          )
          or private.has_tenant_module_permission(%I.tenant_id, %L, 'update')
        );
      $sql$,
        'tenant_user_permission_update', item.table_name,
        'tenant_user_permission_update', item.table_name,
        item.table_name, item.table_name, item.module_key,
        item.table_name, item.table_name, item.module_key
      );

      execute format($sql$
        drop policy if exists %I on public.%I;
        create policy %I on public.%I
        as restrictive for delete to authenticated
        using (
          not exists (
            select 1
            from public.tenant_memberships membership
            where membership.tenant_id = %I.tenant_id
              and membership.user_id = (select auth.uid())
              and membership.active
          )
          or private.has_tenant_module_permission(%I.tenant_id, %L, 'delete')
        );
      $sql$,
        'tenant_user_permission_delete', item.table_name,
        'tenant_user_permission_delete', item.table_name,
        item.table_name, item.table_name, item.module_key
      );
    end if;
  end loop;
end;
$policies$;

comment on table public.tenant_user_permissions is
  'Per-user module/action overrides inside an isolated tenant.';
comment on function private.has_tenant_module_permission(uuid, text, text) is
  'Evaluates explicit per-user module permissions or secure tenant-role defaults.';
