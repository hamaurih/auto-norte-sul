-- Fase 0 — Security containment.
-- Source-of-truth migration for tenant isolation, commission confidentiality and RPC hardening.

-- ---------------------------------------------------------------------------
-- 1. Tenant isolation: remove the cross-tenant bypass from the 80 restrictive
--    policies created by the per-module permission layer.
-- ---------------------------------------------------------------------------
create or replace function private.has_any_active_tenant_membership()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.active
  );
$$;

revoke all on function private.has_any_active_tenant_membership() from public;
revoke all on function private.has_any_active_tenant_membership() from anon;
grant execute on function private.has_any_active_tenant_membership() to authenticated;

do $$
declare
  policy_row record;
  module_key text;
  action_key text;
  guard_expression text;
  changed_count integer := 0;
begin
  for policy_row in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'tenant_user_permission_select',
        'tenant_user_permission_insert',
        'tenant_user_permission_update',
        'tenant_user_permission_delete'
      )
    order by tablename, policyname
  loop
    module_key := case
      when policy_row.tablename in (
        'branches','product_stock','stock_movements','stock_transfer_items',
        'stock_transfers','warehouses'
      ) then 'inventory'
      when policy_row.tablename in (
        'brands','categories','product_applications','product_images','products'
      ) then 'catalog'
      when policy_row.tablename = 'customers' then 'crm'
      when policy_row.tablename in (
        'order_items','orders','quote_items','quotes','sales_orders',
        'sales_rep_customers','sales_reps','stock_reservations'
      ) then 'sales'
      else null
    end;

    if module_key is null then
      raise exception 'Fase 0: tabela sem mapeamento de módulo: %', policy_row.tablename;
    end if;

    action_key := case policy_row.cmd
      when 'SELECT' then 'view'
      when 'INSERT' then 'create'
      when 'UPDATE' then 'update'
      when 'DELETE' then 'delete'
      else null
    end;

    guard_expression := format(
      '(not private.has_any_active_tenant_membership() or private.has_tenant_module_permission(tenant_id, %L, %L))',
      module_key,
      action_key
    );

    if policy_row.cmd = 'INSERT' then
      execute format(
        'alter policy %I on public.%I with check (%s)',
        policy_row.policyname,
        policy_row.tablename,
        guard_expression
      );
    elsif policy_row.cmd = 'UPDATE' then
      execute format(
        'alter policy %I on public.%I using (%s) with check (%s)',
        policy_row.policyname,
        policy_row.tablename,
        guard_expression,
        guard_expression
      );
    else
      execute format(
        'alter policy %I on public.%I using (%s)',
        policy_row.policyname,
        policy_row.tablename,
        guard_expression
      );
    end if;

    changed_count := changed_count + 1;
  end loop;

  if changed_count <> 80 then
    raise exception 'Fase 0: esperado corrigir 80 políticas; corrigidas %', changed_count;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Commission confidentiality. Sellers/viewers may read operational seller
--    fields, never commission_pct. Pricing commission_rate is management-only.
-- ---------------------------------------------------------------------------
revoke select on table public.sales_reps from anon, authenticated;
grant select (
  id,
  user_id,
  full_name,
  email,
  phone,
  active,
  max_discount_pct,
  can_sell_b2b,
  can_create_customer,
  tenant_id,
  invited_by,
  invited_at,
  activated_at,
  created_at,
  updated_at
) on table public.sales_reps to authenticated;
revoke select (commission_pct) on table public.sales_reps from anon, authenticated;

comment on column public.sales_reps.commission_pct is
  'Dado gerencial: leitura apenas em backend após autorização owner/admin/manager.';

do $$
begin
  if to_regclass('public.seller_commission_periods') is not null then
    execute 'drop policy if exists seller_commission_periods_read on public.seller_commission_periods';
    execute $policy$
      create policy seller_commission_periods_read
      on public.seller_commission_periods
      for select
      to authenticated
      using (
        private.has_tenant_role(
          tenant_id,
          array['owner','admin','manager']::text[]
        )
      )
    $policy$;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.product_pricing_settings') is not null then
    execute 'drop policy if exists product_pricing_settings_select on public.product_pricing_settings';
    execute $policy$
      create policy product_pricing_settings_select
      on public.product_pricing_settings
      for select
      to authenticated
      using (
        private.has_tenant_role(
          tenant_id,
          array['owner','admin','manager']::text[]
        )
      )
    $policy$;
    execute $comment$
      comment on column public.product_pricing_settings.commission_rate is
      'Dado gerencial: leitura apenas para owner/admin/manager.'
    $comment$;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. SECURITY DEFINER surface.
-- ---------------------------------------------------------------------------
alter function public.my_access_context() security invoker;
revoke all on function public.my_access_context() from public;
revoke all on function public.my_access_context() from anon;
grant execute on function public.my_access_context() to authenticated;

-- Unscoped/deprecated endpoints are server-only.
revoke all on function public.get_inventory_financial_position() from public;
revoke all on function public.get_inventory_financial_position() from anon;
revoke all on function public.get_inventory_financial_position() from authenticated;
grant execute on function public.get_inventory_financial_position() to service_role;

revoke all on function public.get_commercial_intelligence(uuid, integer) from public;
revoke all on function public.get_commercial_intelligence(uuid, integer) from anon;
revoke all on function public.get_commercial_intelligence(uuid, integer) from authenticated;
grant execute on function public.get_commercial_intelligence(uuid, integer) to service_role;

-- Active RPCs keep authenticated execution only because each implementation
-- validates auth.uid(), tenant scope and an explicit allow-list of tenant roles.
do $$
declare
  privileged_function regprocedure;
begin
  foreach privileged_function in array array[
    'public.approve_product_cost_candidates(uuid[])'::regprocedure,
    'public.approve_product_enrichment_candidate(uuid)'::regprocedure,
    'public.close_inventory_period(date)'::regprocedure,
    'public.confirm_goods_receipt(uuid)'::regprocedure,
    'public.create_fiscal_draft_from_order(uuid,text)'::regprocedure,
    'public.create_replenishment_purchase_orders(uuid,uuid,jsonb)'::regprocedure,
    'public.enqueue_products_for_enrichment(uuid,integer)'::regprocedure,
    'public.get_commercial_intelligence_v2(uuid,integer)'::regprocedure,
    'public.get_replenishment_suggestions(uuid,integer)'::regprocedure,
    'public.get_supplier_performance(uuid,integer)'::regprocedure,
    'public.propose_manual_product_cost(uuid,numeric,text,text)'::regprocedure,
    'public.refresh_cost_sanitation_queue()'::regprocedure,
    'public.reverse_goods_receipt(uuid,text)'::regprocedure
  ]
  loop
    execute format('revoke all on function %s from public', privileged_function);
    execute format('revoke all on function %s from anon', privileged_function);
    execute format('grant execute on function %s to authenticated', privileged_function);
    execute format('grant execute on function %s to service_role', privileged_function);
  end loop;
end
$$;

notify pgrst, 'reload schema';
