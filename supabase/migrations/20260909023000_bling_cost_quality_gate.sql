-- Qualidade de custo recuperado do Bling.
-- O vínculo produto-fornecedor continua sendo evidência, mas a aprovação
-- automática/gerencial só é permitida quando precoCusto e precoCompra se
-- corroboram e o valor não é um outlier grosseiro em relação ao preço atual.

with scored as (
  select
    c.id,
    c.proposed_cost,
    c.current_price,
    link.purchase_price,
    case
      when link.purchase_price is not null
        then abs(c.proposed_cost - link.purchase_price) <= greatest(0.01::numeric, link.purchase_price * 0.05)
      else false
    end as cross_field_corroborated,
    case when c.current_price > 0 then c.proposed_cost / c.current_price else null end as cost_to_sale_ratio
  from public.product_cost_candidates c
  left join lateral (
    select nullif((x->>'purchase_price')::numeric, 0) as purchase_price
    from jsonb_array_elements(coalesce(c.evidence->'supplier_links', '[]'::jsonb)) x
    where x->>'id' = c.evidence->>'selected_relationship_id'
    limit 1
  ) link on true
  where c.source_type = 'bling'
    and c.status = 'pending'
    and c.proposed_cost > 0
), classified as (
  select *,
    cross_field_corroborated
      and current_price > 0
      and cost_to_sale_ratio between 0.01 and 1.50 as eligible,
    case
      when purchase_price is null then 'precoCompra ausente; requer segunda evidência'
      when not cross_field_corroborated then 'precoCusto e precoCompra divergem acima da tolerância'
      when current_price is null or current_price <= 0 then 'preço de venda ausente ou zerado; revisar cadastro'
      when cost_to_sale_ratio < 0.01 then 'custo inferior a 1% do preço de venda; possível erro de unidade/embalagem'
      when cost_to_sale_ratio > 1.50 then 'custo superior a 150% do preço de venda; possível preço ou custo defasado'
      else 'precoCusto e precoCompra corroborados; valor economicamente plausível'
    end as quality_reason
  from scored
)
update public.product_cost_candidates c
set
  confidence = case when q.eligible then 'high' else 'low' end,
  evidence = jsonb_set(
    coalesce(c.evidence, '{}'::jsonb),
    '{quality_gate}',
    jsonb_build_object(
      'eligible', q.eligible,
      'status', case when q.eligible then 'eligible' else 'review' end,
      'cross_field_corroborated', q.cross_field_corroborated,
      'cost_price', q.proposed_cost,
      'purchase_price', q.purchase_price,
      'cost_to_sale_ratio', q.cost_to_sale_ratio,
      'tolerance_pct', 0.05,
      'reason', q.quality_reason,
      'validated_at', now()
    ),
    true
  ),
  notes = case
    when q.eligible then c.notes
    else concat_ws(' ', nullif(c.notes, ''), 'Barreira de qualidade: ' || q.quality_reason || '.')
  end,
  updated_at = now()
from classified q
where c.id = q.id;

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

  if exists (
    select 1
    from public.product_cost_candidates c
    where c.tenant_id = p_tenant_id
      and c.id = any(p_candidate_ids)
      and c.status = 'pending'
      and c.source_type = 'bling'
      and not coalesce((c.evidence->'quality_gate'->>'eligible')::boolean, false)
  ) then
    raise exception 'Há custos do Bling retidos pela barreira de qualidade. Revise a evidência ou informe custo manual antes de aprovar.';
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
      and (
        c.source_type <> 'bling'
        or coalesce((c.evidence->'quality_gate'->>'eligible')::boolean, false)
      )
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
        'source_reference', v_row.source_reference,
        'quality_gate', v_row.evidence->'quality_gate'
      )
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'approved', v_count);
end;
$$;

create or replace function public.approve_validated_bling_cost_batch_v2(
  p_tenant_id uuid,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_result jsonb;
  v_remaining int;
  v_limit int := greatest(1, least(coalesce(p_limit, 500), 1000));
begin
  if p_tenant_id is null then raise exception 'Empresa não informada'; end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_user is null then raise exception 'Não autenticado'; end if;
    if not private.has_tenant_role(p_tenant_id, array['owner','admin','manager']::text[]) then
      raise exception 'Usuário sem permissão para aprovar';
    end if;
  end if;

  select array_agg(id order by updated_at, id)
  into v_ids
  from (
    select id, updated_at
    from public.product_cost_candidates
    where tenant_id = p_tenant_id
      and source_type = 'bling'
      and status = 'pending'
      and proposed_cost > 0
      and coalesce((evidence->'quality_gate'->>'eligible')::boolean, false)
    order by updated_at, id
    limit v_limit
    for update skip locked
  ) q;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'approved', 0, 'remaining', 0);
  end if;

  v_result := public.approve_product_cost_candidates_v2(p_tenant_id, v_ids);

  select count(*)::int into v_remaining
  from public.product_cost_candidates
  where tenant_id = p_tenant_id
    and source_type = 'bling'
    and status = 'pending'
    and proposed_cost > 0
    and coalesce((evidence->'quality_gate'->>'eligible')::boolean, false);

  return jsonb_build_object(
    'ok', true,
    'approved', coalesce((v_result->>'approved')::int, 0),
    'remaining', v_remaining
  );
end;
$$;

revoke all on function public.approve_validated_bling_cost_batch_v2(uuid, integer) from public;
revoke all on function public.approve_validated_bling_cost_batch_v2(uuid, integer) from anon;
grant execute on function public.approve_validated_bling_cost_batch_v2(uuid, integer) to authenticated, service_role;

revoke all on function public.approve_product_cost_candidates_v2(uuid, uuid[]) from public;
revoke all on function public.approve_product_cost_candidates_v2(uuid, uuid[]) from anon;
grant execute on function public.approve_product_cost_candidates_v2(uuid, uuid[]) to authenticated, service_role;
