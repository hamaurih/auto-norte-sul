-- Mandatory Phase 0 regression test.
-- Fails hard if real/demo/no-association isolation regresses.

begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

-- Stable synthetic identities used only inside this rolled-back test transaction.
insert into auth.users (
  id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase0-sales@example.invalid', now(), now(), '{}', '{}', false, false),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase0-viewer@example.invalid', now(), now(), '{}', '{}', false, false),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'phase0-demo-manager@example.invalid', now(), now(), '{}', '{}', false, false),
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'phase0-external@example.invalid', now(), now(), '{}', '{}', false, false);

insert into public.organizations (id, slug, legal_name, trade_name, status)
values (
  '20000000-0000-4000-8000-000000000001',
  'phase0-security-org',
  'Phase 0 Security Test Ltda',
  'Phase 0 Security',
  'active'
);

insert into public.tenants (id, organization_id, name, slug, environment, status)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Phase 0 Conta Real',
    'phase0-real',
    'production',
    'active'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'Phase 0 Conta Demo',
    'phase0-demo',
    'demo',
    'active'
  );

insert into public.tenant_storefronts (tenant_id, slug, active)
values
  ('30000000-0000-4000-8000-000000000001', 'phase0-real-store', true),
  ('30000000-0000-4000-8000-000000000002', 'phase0-demo-store', true);

insert into public.tenant_memberships (tenant_id, user_id, role, active)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'sales', true),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'viewer', true),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'manager', true);

-- Consulta/viewer receives explicit read permission for catalog in its own tenant.
insert into public.tenant_user_permissions (
  tenant_id, user_id, module_key, can_view, can_create, can_update, can_delete
)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'catalog',
  true, false, false, false
);

insert into public.products (
  id, tenant_id, sku, name, slug, price_b2c, stock, active, hide_when_out_of_stock
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'PHASE0-REAL',
    'Phase 0 Produto Real',
    'phase0-produto-real',
    10, 10, true, false
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'PHASE0-DEMO',
    'Phase 0 Produto Demo',
    'phase0-produto-demo',
    10, 10, true, false
  );

set local role authenticated;

-- Vendedor: can read its own real tenant, never demo; cannot modify demo.
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select set_config('request.headers', '{}', true);

do $$
declare
  visible_real integer;
  visible_demo integer;
  changed_demo integer;
begin
  select count(*) into visible_real
  from public.products
  where tenant_id = '30000000-0000-4000-8000-000000000001';

  select count(*) into visible_demo
  from public.products
  where tenant_id = '30000000-0000-4000-8000-000000000002';

  with changed as (
    update public.products
       set featured = not featured
     where id = '40000000-0000-4000-8000-000000000002'
    returning 1
  )
  select count(*) into changed_demo from changed;

  if visible_real <> 1 then
    raise exception 'PHASE0 FAIL: vendedor não lê o próprio tenant real';
  end if;
  if visible_demo <> 0 then
    raise exception 'PHASE0 FAIL: vendedor leu dados do tenant demo';
  end if;
  if changed_demo <> 0 then
    raise exception 'PHASE0 FAIL: vendedor alterou dados do tenant demo';
  end if;
end
$$;

-- Consulta/viewer: explicit read in real only; never reads or writes demo.
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select set_config('request.headers', '{}', true);

do $$
declare
  visible_real integer;
  visible_demo integer;
  changed_demo integer;
begin
  select count(*) into visible_real
  from public.products
  where tenant_id = '30000000-0000-4000-8000-000000000001';

  select count(*) into visible_demo
  from public.products
  where tenant_id = '30000000-0000-4000-8000-000000000002';

  with changed as (
    update public.products
       set featured = not featured
     where id = '40000000-0000-4000-8000-000000000002'
    returning 1
  )
  select count(*) into changed_demo from changed;

  if visible_real <> 1 then
    raise exception 'PHASE0 FAIL: consulta não lê o próprio tenant autorizado';
  end if;
  if visible_demo <> 0 then
    raise exception 'PHASE0 FAIL: consulta leu dados do tenant demo';
  end if;
  if changed_demo <> 0 then
    raise exception 'PHASE0 FAIL: consulta alterou dados do tenant demo';
  end if;
end
$$;

-- Demo manager: can read demo, never real.
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select set_config('request.headers', '{}', true);

do $$
declare
  visible_real integer;
  visible_demo integer;
begin
  select count(*) into visible_real
  from public.products
  where tenant_id = '30000000-0000-4000-8000-000000000001';

  select count(*) into visible_demo
  from public.products
  where tenant_id = '30000000-0000-4000-8000-000000000002';

  if visible_demo <> 1 then
    raise exception 'PHASE0 FAIL: gerente demo não lê o tenant demo';
  end if;
  if visible_real <> 0 then
    raise exception 'PHASE0 FAIL: gerente demo leu o tenant real';
  end if;
end
$$;

-- External authenticated user with no membership: may see only the storefront
-- explicitly selected by x-tenant-slug and cannot write either tenant.
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
select set_config(
  'request.headers',
  '{"x-tenant-slug":"phase0-real-store"}',
  true
);

do $$
declare
  visible_real integer;
  visible_demo integer;
  changed_real integer;
  changed_demo integer;
begin
  select count(*) into visible_real
  from public.products
  where tenant_id = '30000000-0000-4000-8000-000000000001';

  select count(*) into visible_demo
  from public.products
  where tenant_id = '30000000-0000-4000-8000-000000000002';

  with changed as (
    update public.products
       set featured = not featured
     where id = '40000000-0000-4000-8000-000000000001'
    returning 1
  )
  select count(*) into changed_real from changed;

  with changed as (
    update public.products
       set featured = not featured
     where id = '40000000-0000-4000-8000-000000000002'
    returning 1
  )
  select count(*) into changed_demo from changed;

  if visible_real <> 1 then
    raise exception 'PHASE0 FAIL: externo não consegue ler a storefront selecionada';
  end if;
  if visible_demo <> 0 then
    raise exception 'PHASE0 FAIL: externo leu outro tenant';
  end if;
  if changed_real <> 0 or changed_demo <> 0 then
    raise exception 'PHASE0 FAIL: externo conseguiu alterar dados de tenant';
  end if;
end
$$;

-- No association + no storefront header must reveal no catalog tenant.
select set_config('request.headers', '{}', true);
do $$
declare
  visible_products integer;
begin
  select count(*) into visible_products
  from public.products
  where tenant_id in (
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002'
  );

  if visible_products <> 0 then
    raise exception 'PHASE0 FAIL: usuário sem associação/header leu catálogo de tenant';
  end if;
end
$$;

reset role;

-- Structural assertions: commission and privileged RPCs.
do $$
declare
  remaining_legacy_bypass integer;
  hardened_policy_count integer;
begin
  select count(*) into remaining_legacy_bypass
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'tenant_user_permission_select',
      'tenant_user_permission_insert',
      'tenant_user_permission_update',
      'tenant_user_permission_delete'
    )
    and (
      coalesce(qual, '') ilike '%NOT (EXISTS%tenant_memberships%'
      or coalesce(with_check, '') ilike '%NOT (EXISTS%tenant_memberships%'
    );

  select count(*) into hardened_policy_count
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'tenant_user_permission_select',
      'tenant_user_permission_insert',
      'tenant_user_permission_update',
      'tenant_user_permission_delete'
    )
    and (
      coalesce(qual, '') ilike '%has_any_active_tenant_membership%'
      or coalesce(with_check, '') ilike '%has_any_active_tenant_membership%'
    );

  if remaining_legacy_bypass <> 0 then
    raise exception 'PHASE0 FAIL: bypass RLS legado reapareceu';
  end if;
  if hardened_policy_count <> 80 then
    raise exception 'PHASE0 FAIL: esperado 80 políticas endurecidas; encontradas %', hardened_policy_count;
  end if;

  if has_column_privilege('authenticated', 'public.sales_reps', 'commission_pct', 'SELECT') then
    raise exception 'PHASE0 FAIL: commission_pct voltou a ser legível diretamente por authenticated';
  end if;

  if has_function_privilege('anon', 'public.my_access_context()', 'EXECUTE') then
    raise exception 'PHASE0 FAIL: my_access_context voltou a ser executável por anon';
  end if;
end
$$;

select pass('Phase 0: real/demo/external tenant isolation and sensitive access invariants hold');
select * from finish();
rollback;
