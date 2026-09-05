create or replace function public.get_pricing_center_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_total bigint := 0;
  v_active bigint := 0;
  v_with_b2b bigint := 0;
  v_avg_b2b numeric := 0;
  v_avg_b2c numeric := 0;
  v_exceptions bigint := 0;
begin
  if v_uid is null then
    raise exception 'Não autenticado';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = v_uid
      and tm.active
      and tm.role in ('owner','admin','manager')
  ) then
    raise exception 'Sem permissão para consultar formação de preços';
  end if;

  select
    count(*) filter (where p.deleted_at is null),
    count(*) filter (where p.deleted_at is null and p.active),
    count(*) filter (where p.deleted_at is null and coalesce(p.price_b2b,0) > 0),
    coalesce(round(avg(p.price_b2b) filter (where p.deleted_at is null and coalesce(p.price_b2b,0) > 0), 2), 0),
    coalesce(round(avg(p.price_b2c) filter (where p.deleted_at is null and coalesce(p.price_b2c,0) > 0), 2), 0)
  into v_total, v_active, v_with_b2b, v_avg_b2b, v_avg_b2c
  from public.products p
  where p.tenant_id = p_tenant_id;

  select count(*)
  into v_exceptions
  from public.product_b2c_price_rules r
  where r.tenant_id = p_tenant_id;

  return jsonb_build_object(
    'total', v_total,
    'active', v_active,
    'withB2b', v_with_b2b,
    'avgB2b', v_avg_b2b,
    'avgB2c', v_avg_b2c,
    'exceptions', v_exceptions
  );
end;
$$;

revoke all on function public.get_pricing_center_summary(uuid) from public, anon;
grant execute on function public.get_pricing_center_summary(uuid) to authenticated, service_role;
