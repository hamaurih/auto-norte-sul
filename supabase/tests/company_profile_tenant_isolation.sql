begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '10000000-0000-0000-0000-000000000061',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'empresa-1d@example.invalid', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.tenant_memberships (tenant_id, user_id, role, active)
select tenant.id, '10000000-0000-0000-0000-000000000061', 'admin', true
from public.tenants tenant where tenant.environment = 'demo';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000061', true);
select set_config('request.headers', '{"x-tenant-slug":"norte-sul-demo"}', true);

update public.tenant_company_profiles profile
set
  trade_name = 'Empresa Demo Editável',
  primary_color = '#112233',
  updated_by = '10000000-0000-0000-0000-000000000061'
where profile.tenant_id = private.requested_storefront_tenant_id();

do $test$
begin
  if (
    select count(*) from public.tenant_company_profiles
    where trade_name = 'Empresa Demo Editável'
      and primary_color = '#112233'
  ) <> 1 then
    raise exception 'tenant admin could not update own company profile';
  end if;

  if exists (
    select 1
    from public.tenant_company_profiles profile
    join public.tenants tenant on tenant.id = profile.tenant_id
    where tenant.environment = 'production'
  ) then
    raise exception 'demo admin can read production company profile';
  end if;
end;
$test$;

reset role;
rollback;
