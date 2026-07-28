-- Structural smoke test for 20260728020910_create_saas_foundation.sql
-- Run after migrations in a disposable Supabase project.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations',
    'organization_memberships',
    'tenants',
    'tenant_memberships',
    'tenant_modules',
    'audit_events'
  ]
  loop
    if to_regclass('public.' || table_name) is null then
      raise exception 'Missing SaaS foundation table: %', table_name;
    end if;

    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
  end loop;

  if to_regprocedure('private.has_organization_role(uuid,text[])') is null then
    raise exception 'Missing private.has_organization_role';
  end if;

  if to_regprocedure('private.has_tenant_role(uuid,text[])') is null then
    raise exception 'Missing private.has_tenant_role';
  end if;

  if has_table_privilege('anon', 'public.organizations', 'SELECT') then
    raise exception 'anon must not read organizations';
  end if;

  if has_table_privilege('authenticated', 'public.audit_events', 'INSERT') then
    raise exception 'authenticated must not insert audit events directly';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tenants'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%organization_id, environment%'
  ) then
    raise exception 'Missing one-environment-per-organization constraint';
  end if;
end;
$$;
