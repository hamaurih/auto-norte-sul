-- Seleção granular de imagens e aplicações antes da aprovação do enriquecimento.
begin;

create or replace function public.set_product_enrichment_item_selection(
  p_candidate_id uuid,
  p_kind text,
  p_item_ids uuid[] default null,
  p_selected boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.product_enrichment_candidates%rowtype;
  v_user uuid := auth.uid();
  v_changed integer := 0;
  v_selected integer := 0;
  v_total integer := 0;
begin
  select * into v
  from public.product_enrichment_candidates
  where id = p_candidate_id
  for update;

  if not found then raise exception 'Sugestão não encontrada'; end if;
  if v.status <> 'pending' then raise exception 'Sugestão já revisada'; end if;

  if v_user is null or not exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = v.tenant_id
      and m.user_id = v_user
      and m.active
      and m.role in ('owner','admin','manager')
  ) then
    raise exception 'Sem permissão para revisar';
  end if;

  if p_kind = 'image' then
    update public.product_enrichment_candidate_images ci
    set selected = p_selected
    where ci.tenant_id = v.tenant_id
      and ci.candidate_id = v.id
      and (p_item_ids is null or ci.id = any(p_item_ids));
    get diagnostics v_changed = row_count;

    select count(*), count(*) filter (where selected)
      into v_total, v_selected
    from public.product_enrichment_candidate_images ci
    where ci.tenant_id = v.tenant_id and ci.candidate_id = v.id;

  elsif p_kind = 'application' then
    update public.product_enrichment_candidate_applications ca
    set selected = p_selected
    where ca.tenant_id = v.tenant_id
      and ca.candidate_id = v.id
      and (p_item_ids is null or ca.id = any(p_item_ids));
    get diagnostics v_changed = row_count;

    select count(*), count(*) filter (where selected)
      into v_total, v_selected
    from public.product_enrichment_candidate_applications ca
    where ca.tenant_id = v.tenant_id and ca.candidate_id = v.id;

  else
    raise exception 'Tipo de item inválido';
  end if;

  return jsonb_build_object(
    'ok', true,
    'candidate_id', v.id,
    'kind', p_kind,
    'changed', v_changed,
    'selected', v_selected,
    'total', v_total
  );
end;
$$;

revoke all on function public.set_product_enrichment_item_selection(uuid,text,uuid[],boolean) from public, anon;
grant execute on function public.set_product_enrichment_item_selection(uuid,text,uuid[],boolean) to authenticated, service_role;

commit;
