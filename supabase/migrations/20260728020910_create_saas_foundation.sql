-- Auto Deal Hub SaaS foundation (phase 1A)
-- Additive only: existing operational tables remain unchanged in this phase.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  legal_name text not null,
  trade_name text,
  tax_id text,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'billing', 'auditor')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- A tenant is the hard data-isolation boundary. Production and demo never share a tenant.
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  environment text not null check (environment in ('production', 'demo', 'sandbox')),
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, environment)
);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'sales', 'cashier', 'stock', 'finance', 'accountant', 'support', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table public.tenant_modules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module_key text not null check (module_key in ('catalog', 'sales', 'pos', 'inventory', 'purchasing', 'finance', 'fiscal', 'crm', 'ecommerce', 'ai', 'reports', 'integrations')),
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, module_key)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  tenant_id uuid references public.tenants(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index organization_memberships_user_idx on public.organization_memberships (user_id, organization_id) where active;
create index tenants_organization_idx on public.tenants (organization_id, environment) where status = 'active';
create index tenant_memberships_user_idx on public.tenant_memberships (user_id, tenant_id) where active;
create index audit_events_tenant_created_idx on public.audit_events (tenant_id, created_at desc);
create index audit_events_organization_created_idx on public.audit_events (organization_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.has_organization_role(target_organization_id uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.active
      and (allowed_roles is null or membership.role = any (allowed_roles))
  );
$$;

create or replace function private.has_tenant_role(target_tenant_id uuid, allowed_roles text[] default null)
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
      and membership.user_id = auth.uid()
      and membership.active
      and (allowed_roles is null or membership.role = any (allowed_roles))
  );
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.has_organization_role(uuid, text[]) from public;
revoke all on function private.has_tenant_role(uuid, text[]) from public;
grant execute on function private.has_organization_role(uuid, text[]) to authenticated;
grant execute on function private.has_tenant_role(uuid, text[]) to authenticated;

create trigger organizations_set_updated_at before update on public.organizations
for each row execute function private.set_updated_at();
create trigger organization_memberships_set_updated_at before update on public.organization_memberships
for each row execute function private.set_updated_at();
create trigger tenants_set_updated_at before update on public.tenants
for each row execute function private.set_updated_at();
create trigger tenant_memberships_set_updated_at before update on public.tenant_memberships
for each row execute function private.set_updated_at();
create trigger tenant_modules_set_updated_at before update on public.tenant_modules
for each row execute function private.set_updated_at();

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_modules enable row level security;
alter table public.audit_events enable row level security;

create policy organizations_select_members on public.organizations
for select to authenticated
using (private.has_organization_role(id));

create policy organizations_update_admins on public.organizations
for update to authenticated
using (private.has_organization_role(id, array['owner', 'admin']))
with check (private.has_organization_role(id, array['owner', 'admin']));

create policy organization_memberships_select_members on public.organization_memberships
for select to authenticated
using (private.has_organization_role(organization_id));

create policy organization_memberships_insert_admins on public.organization_memberships
for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin']));

create policy organization_memberships_update_admins on public.organization_memberships
for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']))
with check (private.has_organization_role(organization_id, array['owner', 'admin']));

create policy organization_memberships_delete_admins on public.organization_memberships
for delete to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']));

create policy tenants_select_members on public.tenants
for select to authenticated
using (private.has_organization_role(organization_id));

create policy tenants_insert_admins on public.tenants
for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin']));

create policy tenants_update_admins on public.tenants
for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']))
with check (private.has_organization_role(organization_id, array['owner', 'admin']));

create policy tenant_memberships_select_authorized on public.tenant_memberships
for select to authenticated
using (
  private.has_tenant_role(tenant_id)
  or private.has_organization_role((select organization_id from public.tenants where id = tenant_id), array['owner', 'admin', 'auditor'])
);

create policy tenant_memberships_insert_admins on public.tenant_memberships
for insert to authenticated
with check (
  private.has_organization_role((select organization_id from public.tenants where id = tenant_id), array['owner', 'admin'])
  or private.has_tenant_role(tenant_id, array['owner', 'admin'])
);

create policy tenant_memberships_update_admins on public.tenant_memberships
for update to authenticated
using (
  private.has_organization_role((select organization_id from public.tenants where id = tenant_id), array['owner', 'admin'])
  or private.has_tenant_role(tenant_id, array['owner', 'admin'])
)
with check (
  private.has_organization_role((select organization_id from public.tenants where id = tenant_id), array['owner', 'admin'])
  or private.has_tenant_role(tenant_id, array['owner', 'admin'])
);

create policy tenant_memberships_delete_admins on public.tenant_memberships
for delete to authenticated
using (
  private.has_organization_role((select organization_id from public.tenants where id = tenant_id), array['owner', 'admin'])
  or private.has_tenant_role(tenant_id, array['owner', 'admin'])
);

create policy tenant_modules_select_members on public.tenant_modules
for select to authenticated
using (private.has_tenant_role(tenant_id));

create policy tenant_modules_insert_admins on public.tenant_modules
for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner', 'admin']));

create policy tenant_modules_update_admins on public.tenant_modules
for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner', 'admin']))
with check (private.has_tenant_role(tenant_id, array['owner', 'admin']));

create policy tenant_modules_delete_admins on public.tenant_modules
for delete to authenticated
using (private.has_tenant_role(tenant_id, array['owner', 'admin']));

create policy audit_events_select_authorized on public.audit_events
for select to authenticated
using (
  private.has_organization_role(organization_id, array['owner', 'admin', 'auditor'])
  or (tenant_id is not null and private.has_tenant_role(tenant_id, array['owner', 'admin', 'manager', 'accountant']))
);

-- Explicit Data API privileges. Anonymous access is intentionally denied.
revoke all on public.organizations, public.organization_memberships, public.tenants,
  public.tenant_memberships, public.tenant_modules, public.audit_events from anon;
revoke all on public.organizations, public.organization_memberships, public.tenants,
  public.tenant_memberships, public.tenant_modules, public.audit_events from authenticated;

grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select, insert, update on public.tenants to authenticated;
grant select, insert, update, delete on public.tenant_memberships to authenticated;
grant select, insert, update, delete on public.tenant_modules to authenticated;
grant select on public.audit_events to authenticated;
grant usage, select on sequence public.audit_events_id_seq to service_role;

comment on table public.organizations is 'Commercial SaaS account; owns isolated tenants.';
comment on table public.tenants is 'Hard isolation boundary for production, demo, or sandbox data.';
comment on table public.audit_events is 'Append-only audit trail. Client roles have read-only access; writes use trusted backend code.';
