-- Destructive-free isolation test. All fixtures are rolled back.
begin;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'tenant-prod-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
 ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'tenant-demo-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.tenant_memberships (tenant_id, user_id, role)
select id, '10000000-0000-0000-0000-000000000001', 'admin'
from public.tenants where environment = 'production';
insert into public.tenant_memberships (tenant_id, user_id, role)
select id, '20000000-0000-0000-0000-000000000002', 'admin'
from public.tenants where environment = 'demo';

insert into public.branches (tenant_id, name, code, is_main)
select id, 'Filial Demo', 'MATRIZ', true
from public.tenants where environment = 'demo';
insert into public.warehouses (tenant_id, branch_id, name, code, is_default)
select branch.tenant_id, branch.id, 'Depósito Demo', 'GERAL', true
from public.branches branch
join public.tenants tenant on tenant.id = branch.tenant_id
where tenant.environment = 'demo';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
declare visible_branches integer; visible_warehouses integer;
begin
  select count(*) into visible_branches from public.branches;
  select count(*) into visible_warehouses from public.warehouses;
  if visible_branches <> 1 or visible_warehouses <> 1 then
    raise exception 'Production isolation failed: branches %, warehouses %', visible_branches, visible_warehouses;
  end if;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare visible_branches integer; visible_warehouses integer;
begin
  select count(*) into visible_branches from public.branches;
  select count(*) into visible_warehouses from public.warehouses;
  if visible_branches <> 1 or visible_warehouses <> 1 then
    raise exception 'Demo isolation failed: branches %, warehouses %', visible_branches, visible_warehouses;
  end if;
end;
$$;

reset role;
do $$
declare demo_tenant uuid; production_branch uuid;
begin
  select id into demo_tenant from public.tenants where environment = 'demo';
  select branch.id into production_branch
  from public.branches branch
  join public.tenants tenant on tenant.id = branch.tenant_id
  where tenant.environment = 'production';

  begin
    insert into public.warehouses (tenant_id, branch_id, name, code)
    values (demo_tenant, production_branch, 'Cross Tenant Invalid', 'INVALID');
    raise exception 'Composite tenant foreign key accepted a cross-tenant warehouse';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

rollback;
