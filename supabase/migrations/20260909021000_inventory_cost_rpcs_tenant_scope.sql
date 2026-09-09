-- Endurece as RPCs financeiras/de saneamento que ainda escolhiam a primeira
-- membership ativa do usuário. As versões v2 exigem tenant explícito e
-- validam owner/admin/manager no próprio banco.

create or replace function public.close_inventory_period_v2(
  p_tenant_id uuid,
  p_period_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_closing_id uuid;
  v_period date := (date_trunc('month', p_period_date)::date + interval '1 month - 1 day')::date;
  v_org uuid;
begin
  if p_tenant_id is null then raise exception 'Empresa não informada'; end if;
  if p_period_date is null then raise exception 'Período não informado'; end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_user is null then raise exception 'Não autenticado'; end if;
    if not private.has_tenant_role(p_tenant_id, array['owner','admin','manager']::text[]) then
      raise exception 'Usuário sem permissão para fechar estoque';
    end if;
  end if;

  if v_period > current_date then raise exception 'Não é permitido fechar período futuro'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_period::text, 0));

  select id into v_closing_id
  from public.inventory_closings
  where tenant_id = p_tenant_id and period_date = v_period
  for update;

  if v_closing_id is not null then
    return jsonb_build_object(
      'ok', true,
      'already_closed', true,
      'closing_id', v_closing_id,
      'period_date', v_period
    );
  end if;

  insert into public.inventory_closings(tenant_id, period_date, closed_by)
  values(p_tenant_id, v_period, v_user)
  returning id into v_closing_id;

  insert into public.inventory_closing_items
    (tenant_id, closing_id, product_id, warehouse_id, on_hand, average_cost, inventory_value, cost_status)
  select p_tenant_id, v_closing_id, ps.product_id, ps.warehouse_id, ps.on_hand, p.average_cost,
         round(ps.on_hand * coalesce(p.average_cost, 0), 2),
         case when p.average_cost is null then 'missing' else 'valued' end
  from public.product_stock ps
  join public.products p on p.id = ps.product_id and p.tenant_id = ps.tenant_id
  where ps.tenant_id = p_tenant_id and ps.on_hand <> 0
  order by ps.product_id, ps.warehouse_id
  for share of ps, p;

  update public.inventory_closings c set
    products_count = x.products_count,
    units_total = x.units_total,
    inventory_value = x.inventory_value,
    missing_cost_products = x.missing_cost_products
  from (
    select count(distinct product_id)::int products_count,
           coalesce(sum(on_hand), 0) units_total,
           coalesce(sum(inventory_value), 0) inventory_value,
           count(distinct product_id) filter(where cost_status = 'missing')::int missing_cost_products
    from public.inventory_closing_items
    where closing_id = v_closing_id
  ) x
  where c.id = v_closing_id;

  select organization_id into v_org from public.tenants where id = p_tenant_id;

  insert into public.audit_events
    (organization_id, tenant_id, actor_user_id, action, resource_type, resource_id, after_data)
  select v_org, p_tenant_id, v_user, 'inventory.period_closed', 'inventory_closing', v_closing_id::text,
         to_jsonb(c)
  from public.inventory_closings c
  where c.id = v_closing_id;

  return (
    select jsonb_build_object(
      'ok', true,
      'already_closed', false,
      'closing_id', id,
      'period_date', period_date,
      'products_count', products_count,
      'units_total', units_total,
      'inventory_value', inventory_value,
      'missing_cost_products', missing_cost_products
    )
    from public.inventory_closings
    where id = v_closing_id
  );
end;
$$;

create or replace function public.refresh_cost_sanitation_queue_v2(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count int := 0;
begin
  if p_tenant_id is null then raise exception 'Empresa não informada'; end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_user is null then raise exception 'Não autenticado'; end if;
    if not private.has_tenant_role(p_tenant_id, array['owner','admin','manager']::text[]) then
      raise exception 'Usuário sem permissão';
    end if;
  end if;

  insert into public.product_cost_candidates(
    tenant_id, product_id, proposed_cost, source_type, source_reference, source_date, confidence, status, evidence,
    current_price, suggested_price, projected_margin_rate, created_by
  )
  select p_tenant_id, p.id, src.cost, coalesce(src.source_type, 'missing'), src.reference, src.source_date,
    case
      when src.source_type in ('nfe_xml','goods_receipt') then 'high'
      when src.source_type = 'purchase_order' then 'medium'
      else 'none'
    end,
    case when src.cost > 0 then 'pending' else 'awaiting_source' end,
    coalesce(src.evidence, '{}'::jsonb),
    p.price_b2c,
    private.cost_suggested_price(p_tenant_id, p.id, src.cost),
    case when src.cost > 0 and p.price_b2c > 0 then round((p.price_b2c - src.cost) / p.price_b2c, 6) else null end,
    v_user
  from public.products p
  left join lateral (
    select x.cost, x.source_type, x.reference, x.source_date, x.evidence
    from (
      select
        ni.unit_value + (coalesce(ni.freight_amount, 0) + coalesce(ni.other_amount, 0) - coalesce(ni.discount_amount, 0)) / nullif(ni.qty, 0) cost,
        'nfe_xml'::text source_type,
        'NF-e ' || coalesce(n.nfe_number::text, n.access_key) reference,
        coalesce(n.issued_at, n.created_at) source_date,
        jsonb_build_object('nfe_import_id', n.id, 'item_id', ni.id) evidence,
        1 priority
      from public.nfe_import_items ni
      join public.nfe_imports n on n.id = ni.nfe_import_id
      where ni.tenant_id = p_tenant_id
        and ni.product_id = p.id
        and ni.qty > 0
        and ni.unit_value > 0
        and n.status <> 'cancelled'

      union all

      select
        ri.acquisition_unit_cost,
        'goods_receipt',
        'Recebimento #' || r.number,
        r.confirmed_at,
        jsonb_build_object('goods_receipt_id', r.id, 'item_id', ri.id),
        2
      from public.goods_receipt_items ri
      join public.goods_receipts r on r.id = ri.goods_receipt_id
      where ri.tenant_id = p_tenant_id
        and ri.product_id = p.id
        and ri.acquisition_unit_cost > 0
        and r.status = 'confirmed'

      union all

      select
        oi.unit_cost,
        'purchase_order',
        'Pedido #' || o.number,
        o.created_at,
        jsonb_build_object('purchase_order_id', o.id, 'item_id', oi.id),
        3
      from public.purchase_order_items oi
      join public.purchase_orders o on o.id = oi.purchase_order_id
      where oi.tenant_id = p_tenant_id
        and oi.product_id = p.id
        and oi.unit_cost > 0
        and o.status <> 'cancelled'
    ) x
    order by priority, source_date desc
    limit 1
  ) src on true
  where p.tenant_id = p_tenant_id
    and p.stock > 0
    and p.average_cost is null
  on conflict(tenant_id, product_id) where status in ('awaiting_source','pending')
  do update set
    proposed_cost = excluded.proposed_cost,
    source_type = excluded.source_type,
    source_reference = excluded.source_reference,
    source_date = excluded.source_date,
    confidence = excluded.confidence,
    status = excluded.status,
    evidence = excluded.evidence,
    current_price = excluded.current_price,
    suggested_price = excluded.suggested_price,
    projected_margin_rate = excluded.projected_margin_rate,
    updated_at = now();

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'processed', v_count);
end;
$$;

create or replace function public.propose_manual_product_cost_v2(
  p_tenant_id uuid,
  p_product_id uuid,
  p_cost numeric,
  p_evidence_reference text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_price numeric;
begin
  if p_tenant_id is null then raise exception 'Empresa não informada'; end if;
  if p_cost is null or p_cost <= 0 then raise exception 'Custo deve ser maior que zero'; end if;
  if length(btrim(coalesce(p_evidence_reference, ''))) < 3 then raise exception 'Informe a evidência do custo'; end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_user is null then raise exception 'Não autenticado'; end if;
    if not private.has_tenant_role(p_tenant_id, array['owner','admin','manager']::text[]) then
      raise exception 'Usuário sem permissão';
    end if;
  end if;

  select price_b2c into v_price
  from public.products
  where id = p_product_id and tenant_id = p_tenant_id;

  if not found then raise exception 'Produto ou permissão inválida'; end if;

  insert into public.product_cost_candidates(
    tenant_id, product_id, proposed_cost, source_type, source_reference, source_date, confidence, status,
    evidence, notes, current_price, suggested_price, projected_margin_rate, created_by
  )
  values(
    p_tenant_id,
    p_product_id,
    p_cost,
    'manual',
    btrim(p_evidence_reference),
    now(),
    'medium',
    'pending',
    jsonb_build_object('declared_by', v_user),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_price,
    private.cost_suggested_price(p_tenant_id, p_product_id, p_cost),
    case when v_price > 0 then round((v_price - p_cost) / v_price, 6) end,
    v_user
  )
  on conflict(tenant_id, product_id) where status in ('awaiting_source','pending')
  do update set
    proposed_cost = excluded.proposed_cost,
    source_type = 'manual',
    source_reference = excluded.source_reference,
    source_date = now(),
    confidence = 'medium',
    status = 'pending',
    evidence = excluded.evidence,
    notes = excluded.notes,
    current_price = excluded.current_price,
    suggested_price = excluded.suggested_price,
    projected_margin_rate = excluded.projected_margin_rate,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'candidate_id', v_id);
end;
$$;

create or replace function public.approve_product_cost_candidates_v2(
  p_tenant_id uuid,
  p_candidate_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row record;
  v_count int := 0;
  v_org uuid;
begin
  if p_tenant_id is null then raise exception 'Empresa não informada'; end if;
  if coalesce(array_length(p_candidate_ids, 1), 0) = 0 then raise exception 'Selecione ao menos um custo'; end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_user is null then raise exception 'Não autenticado'; end if;
    if not private.has_tenant_role(p_tenant_id, array['owner','admin','manager']::text[]) then
      raise exception 'Usuário sem permissão para aprovar';
    end if;
  end if;

  select organization_id into v_org from public.tenants where id = p_tenant_id;

  for v_row in
    select c.*, p.average_cost, p.last_purchase_cost
    from public.product_cost_candidates c
    join public.products p on p.id = c.product_id and p.tenant_id = c.tenant_id
    where c.tenant_id = p_tenant_id
      and c.id = any(p_candidate_ids)
      and c.status = 'pending'
      and c.proposed_cost > 0
    order by c.product_id
    for update of c, p
  loop
    update public.products
    set average_cost = v_row.proposed_cost,
        last_purchase_cost = coalesce(last_purchase_cost, v_row.proposed_cost),
        updated_at = now()
    where id = v_row.product_id and tenant_id = p_tenant_id;

    insert into public.product_cost_history(
      tenant_id, product_id, source, reference_id, qty, unit_cost,
      previous_average_cost, new_average_cost, previous_last_cost, new_last_cost, created_by
    )
    values(
      p_tenant_id,
      v_row.product_id,
      'cost_sanitation',
      v_row.id,
      0,
      v_row.proposed_cost,
      v_row.average_cost,
      v_row.proposed_cost,
      v_row.last_purchase_cost,
      coalesce(v_row.last_purchase_cost, v_row.proposed_cost),
      v_user
    );

    update public.product_cost_candidates
    set status = 'approved', reviewed_by = v_user, reviewed_at = now(), updated_at = now()
    where id = v_row.id and tenant_id = p_tenant_id;

    insert into public.audit_events(
      organization_id, tenant_id, actor_user_id, action, resource_type, resource_id,
      before_data, after_data, metadata
    )
    values(
      v_org,
      p_tenant_id,
      v_user,
      'product.cost_sanitized',
      'product',
      v_row.product_id::text,
      jsonb_build_object('average_cost', v_row.average_cost),
      jsonb_build_object('average_cost', v_row.proposed_cost),
      jsonb_build_object(
        'candidate_id', v_row.id,
        'source_type', v_row.source_type,
        'source_reference', v_row.source_reference
      )
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'approved', v_count);
end;
$$;

revoke all on function public.close_inventory_period_v2(uuid, date) from public;
revoke all on function public.close_inventory_period_v2(uuid, date) from anon;
grant execute on function public.close_inventory_period_v2(uuid, date) to authenticated, service_role;

revoke all on function public.refresh_cost_sanitation_queue_v2(uuid) from public;
revoke all on function public.refresh_cost_sanitation_queue_v2(uuid) from anon;
grant execute on function public.refresh_cost_sanitation_queue_v2(uuid) to authenticated, service_role;

revoke all on function public.propose_manual_product_cost_v2(uuid, uuid, numeric, text, text) from public;
revoke all on function public.propose_manual_product_cost_v2(uuid, uuid, numeric, text, text) from anon;
grant execute on function public.propose_manual_product_cost_v2(uuid, uuid, numeric, text, text) to authenticated, service_role;

revoke all on function public.approve_product_cost_candidates_v2(uuid, uuid[]) from public;
revoke all on function public.approve_product_cost_candidates_v2(uuid, uuid[]) from anon;
grant execute on function public.approve_product_cost_candidates_v2(uuid, uuid[]) to authenticated, service_role;
