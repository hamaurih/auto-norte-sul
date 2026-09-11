-- Keep privileged implementations outside the exposed Data API schema.
-- Public RPC names remain stable as SECURITY INVOKER façades, while the
-- private implementations retain their existing auth.uid()/tenant checks.

grant usage on schema private to authenticated, service_role;

do $migration$
declare
  v_function_names constant text[] := array[
    'approve_product_cost_candidates',
    'approve_product_enrichment_candidate',
    'cancel_pos_sale',
    'close_inventory_period',
    'close_pos_cash_session',
    'confirm_goods_receipt',
    'create_fiscal_draft_from_order',
    'create_replenishment_purchase_orders',
    'enqueue_products_for_enrichment',
    'finalize_pos_sale',
    'get_commercial_intelligence',
    'get_commercial_intelligence_v2',
    'get_inventory_financial_position',
    'get_replenishment_suggestions',
    'get_supplier_performance',
    'open_pos_cash_session',
    'propose_manual_product_cost',
    'record_pos_cash_movement',
    'refresh_cost_sanitation_queue',
    'reverse_goods_receipt',
    'set_product_enrichment_item_selection'
  ];
  v_function record;
  v_call_arguments text;
  v_body text;
  v_volatility text;
  v_parallel text;
  v_strict text;
begin
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
    raise exception 'Authenticated SECURITY DEFINER RPCs remain in public schema';
  end if;
end
$migration$;

-- PostgreSQL grants EXECUTE to PUBLIC on new functions by default. Revoke that
-- default for future functions; migrations must grant only the roles they need.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

notify pgrst, 'reload schema';
