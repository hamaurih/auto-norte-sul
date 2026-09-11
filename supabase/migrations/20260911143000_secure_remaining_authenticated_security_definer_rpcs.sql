-- Finish hardening SECURITY DEFINER RPCs exposed through the public Data API.
-- The public signatures stay stable as SECURITY INVOKER facades, while the
-- privileged implementations move to the non-exposed private schema.
--
-- Each function in this list was reviewed in production before this migration:
-- it authenticates the caller directly or delegates tenant/permission checks to
-- private helpers. No anonymous EXECUTE grants existed at review time.

grant usage on schema private to authenticated, service_role;

do $migration$
declare
  v_function_names constant text[] := array[
    'apply_price_adjustment',
    'approve_product_cost_candidates_v2',
    'approve_validated_bling_cost_batch_v2',
    'close_inventory_period_v2',
    'generate_vehicle_application_candidates_from_names',
    'get_inventory_financial_position_v2',
    'get_my_private_profile',
    'get_pricing_center_summary',
    'get_profitability_dashboard',
    'get_vehicle_application_center_stats',
    'preview_price_adjustment',
    'propose_manual_product_cost_v2',
    'refresh_cost_sanitation_queue_v2',
    'review_vehicle_application_candidate',
    'set_global_b2c_markup',
    'set_product_b2c_rule',
    'simulate_product_profitability',
    'update_my_private_profile'
  ];
  v_function record;
  v_call_arguments text;
  v_body text;
  v_volatility text;
  v_parallel text;
  v_strict text;
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = any(v_function_names)
  ) then
    raise exception 'Private implementation name collision detected';
  end if;

  for v_function in
    select
      p.oid,
      p.proname,
      p.pronargs,
      p.proretset,
      p.provolatile,
      p.proparallel,
      p.proisstrict,
      pg_get_function_arguments(p.oid) as arguments,
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_get_function_result(p.oid) as result_type
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(v_function_names)
      and has_function_privilege('authenticated', p.oid, 'execute')
    order by p.proname, p.oid::regprocedure::text
  loop
    select coalesce(string_agg(format('$%s', position), ', '), '')
      into v_call_arguments
    from generate_series(1, v_function.pronargs) as position;

    v_body := case
      when v_function.proretset
        then format('select * from private.%I(%s);', v_function.proname, v_call_arguments)
      else format('select private.%I(%s);', v_function.proname, v_call_arguments)
    end;

    v_volatility := case v_function.provolatile
      when 'i' then 'immutable'
      when 's' then 'stable'
      else 'volatile'
    end;
    v_parallel := case v_function.proparallel
      when 's' then 'parallel safe'
      when 'r' then 'parallel restricted'
      else 'parallel unsafe'
    end;
    v_strict := case when v_function.proisstrict then 'strict' else 'called on null input' end;

    execute format(
      'alter function public.%I(%s) set schema private',
      v_function.proname,
      v_function.identity_arguments
    );
    execute format(
      'revoke all on function private.%I(%s) from public, anon',
      v_function.proname,
      v_function.identity_arguments
    );
    execute format(
      'grant execute on function private.%I(%s) to authenticated, service_role',
      v_function.proname,
      v_function.identity_arguments
    );

    execute format(
      'create function public.%I(%s) returns %s language sql %s %s %s security invoker set search_path = %L as $wrapper$ %s $wrapper$',
      v_function.proname,
      v_function.arguments,
      v_function.result_type,
      v_volatility,
      v_parallel,
      v_strict,
      '',
      v_body
    );
    execute format(
      'revoke all on function public.%I(%s) from public, anon',
      v_function.proname,
      v_function.identity_arguments
    );
    execute format(
      'grant execute on function public.%I(%s) to authenticated, service_role',
      v_function.proname,
      v_function.identity_arguments
    );
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(v_function_names)
      and has_function_privilege('authenticated', p.oid, 'execute')
  ) then
    raise exception 'Authenticated SECURITY DEFINER RPCs remain in public schema after hardening';
  end if;
end
$migration$;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

notify pgrst, 'reload schema';
