-- Phase 1B: hard tenant isolation for branches and warehouses.

alter table public.branches add column tenant_id uuid;
alter table public.warehouses add column tenant_id uuid;

-- Client-zero backfill. Existing operational records belong to Norte Sul production.
update public.branches
set tenant_id = (
  select tenant.id
  from public.tenants tenant
  join public.organizations organization on organization.id = tenant.organization_id
  where organization.slug = 'norte-sul-acessorios'
    and tenant.environment = 'production'
);

update public.warehouses warehouse
set tenant_id = branch.tenant_id
from public.branches branch
where branch.id = warehouse.branch_id;

do $$
begin
  if exists (select 1 from public.branches where tenant_id is null) then
    raise exception 'Cannot tenantize branches: rows without tenant assignment';
  end if;
  if exists (select 1 from public.warehouses where tenant_id is null) then
    raise exception 'Cannot tenantize warehouses: rows without tenant assignment';
  end if;
end;
$$;

alter table public.branches alter column tenant_id set not null;
alter table public.warehouses alter column tenant_id set not null;

alter table public.branches
  add constraint branches_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;

alter table public.branches
  add constraint branches_id_tenant_key unique (id, tenant_id);

alter table public.warehouses
  add constraint warehouses_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;

alter table public.warehouses drop constraint warehouses_branch_id_fkey;
alter table public.warehouses
  add constraint warehouses_branch_tenant_fkey
  foreign key (branch_id, tenant_id)
  references public.branches(id, tenant_id) on delete restrict;

-- Codes are unique inside a tenant, not across the entire SaaS.
alter table public.branches drop constraint branches_code_key;
alter table public.branches
  add constraint branches_tenant_code_key unique (tenant_id, code);

alter table public.warehouses drop constraint warehouses_code_key;
alter table public.warehouses
  add constraint warehouses_tenant_code_key unique (tenant_id, code);

create unique index branches_one_main_per_tenant_idx
  on public.branches (tenant_id)
  where is_main and active;

create unique index warehouses_one_default_per_branch_idx
  on public.warehouses (branch_id)
  where is_default and active;

create index branches_tenant_active_idx
  on public.branches (tenant_id, active);
create index warehouses_tenant_branch_active_idx
  on public.warehouses (tenant_id, branch_id, active);

-- Remove legacy global-role and public policies.
drop policy if exists branches_public_read on public.branches;
drop policy if exists branches_staff_all on public.branches;
drop policy if exists warehouses_public_read on public.warehouses;
drop policy if exists warehouses_staff_all on public.warehouses;

create policy branches_tenant_read on public.branches
for select to authenticated
using (private.has_tenant_role(tenant_id));

create policy branches_tenant_insert on public.branches
for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

create policy branches_tenant_update on public.branches
for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']))
with check (private.has_tenant_role(tenant_id, array['owner', 'admin', 'manager']));

create policy branches_tenant_delete on public.branches
for delete to authenticated
using (private.has_tenant_role(tenant_id, array['owner', 'admin']));

create policy warehouses_tenant_read on public.warehouses
for select to authenticated
using (private.has_tenant_role(tenant_id));

create policy warehouses_tenant_insert on public.warehouses
for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner', 'admin', 'manager', 'stock']));

create policy warehouses_tenant_update on public.warehouses
for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner', 'admin', 'manager', 'stock']))
with check (private.has_tenant_role(tenant_id, array['owner', 'admin', 'manager', 'stock']));

create policy warehouses_tenant_delete on public.warehouses
for delete to authenticated
using (private.has_tenant_role(tenant_id, array['owner', 'admin']));

-- Branch topology is administrative data; do not expose it anonymously.
revoke all on public.branches, public.warehouses from anon;
revoke all on public.branches, public.warehouses from authenticated;
grant select, insert, update, delete on public.branches, public.warehouses to authenticated;

comment on column public.branches.tenant_id is 'Hard SaaS isolation boundary.';
comment on column public.warehouses.tenant_id is 'Must match the tenant of branch_id through a composite foreign key.';
