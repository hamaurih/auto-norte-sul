-- Corrige a posição financeira do estoque para o modelo multiempresa.
-- A RPC legada sem tenant explícito permanece restrita a service_role.
-- A versão v2 exige tenant explícito e valida membership administrativa.

create or replace function public.get_inventory_financial_position_v2(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if p_tenant_id is null then
    raise exception 'Empresa não informada';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_user is null then
      raise exception 'Não autenticado';
    end if;

    if not private.has_tenant_role(
      p_tenant_id,
      array['owner','admin','manager']::text[]
    ) then
      raise exception 'Usuário sem permissão para consultar a posição financeira do estoque';
    end if;
  end if;

  select jsonb_build_object(
    'products_with_stock', count(*) filter (where s.on_hand > 0),
    'valued_products', count(*) filter (where s.on_hand > 0 and p.average_cost is not null),
    'missing_cost_products', count(*) filter (where s.on_hand > 0 and p.average_cost is null),
    'units_total', coalesce(sum(s.on_hand) filter (where s.on_hand > 0), 0),
    'inventory_value', coalesce(sum(s.on_hand * coalesce(p.average_cost, 0)) filter (where s.on_hand > 0), 0),
    'potential_revenue', coalesce(sum(s.on_hand * p.price_b2c) filter (where s.on_hand > 0), 0),
    'potential_gross_profit', coalesce(sum(s.on_hand * (p.price_b2c - coalesce(p.average_cost, 0))) filter (where s.on_hand > 0 and p.average_cost is not null), 0),
    'stock_divergence_products', (
      select count(*)
      from public.products px
      left join (
        select product_id, sum(on_hand) qty
        from public.product_stock
        where tenant_id = p_tenant_id
        group by product_id
      ) ps on ps.product_id = px.id
      where px.tenant_id = p_tenant_id
        and px.stock <> coalesce(ps.qty, 0)
    )
  ) into v_result
  from public.products p
  join (
    select product_id, sum(on_hand)::numeric as on_hand
    from public.product_stock
    where tenant_id = p_tenant_id
    group by product_id
  ) s on s.product_id = p.id
  where p.tenant_id = p_tenant_id;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_inventory_financial_position_v2(uuid) from public;
revoke all on function public.get_inventory_financial_position_v2(uuid) from anon;
grant execute on function public.get_inventory_financial_position_v2(uuid) to authenticated;
grant execute on function public.get_inventory_financial_position_v2(uuid) to service_role;

comment on function public.get_inventory_financial_position_v2(uuid) is
  'Posição financeira de estoque tenant-scoped; owner/admin/manager ou service_role.';
