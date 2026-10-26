-- Specialized auto-approval for catalog-name recovery.
-- It updates ONLY the commercial name; GTIN, images and applications remain untouched.

create or replace function public.auto_approve_catalog_name_candidate(
  p_candidate_id uuid,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.product_enrichment_candidates%rowtype;
  j public.product_enrichment_jobs%rowtype;
  p public.products%rowtype;
  v_domain text;
  v_matched_code text;
  v_suggested_code text;
  v_reason text := null;
begin
  select * into v
  from public.product_enrichment_candidates
  where id=p_candidate_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'eligible',false,'reason','Sugestão não encontrada');
  end if;
  if v.status <> 'pending' then
    return jsonb_build_object('ok',false,'eligible',false,'reason','Sugestão já revisada');
  end if;

  select * into j
  from public.product_enrichment_jobs
  where id=v.job_id and tenant_id=v.tenant_id
  for update;

  if not found or coalesce(j.search_query,'') not like '[catalog-name]%' then
    v_reason := 'Sugestão não pertence à campanha de recuperação de nome';
  end if;

  select * into p
  from public.products
  where id=v.product_id
    and tenant_id=v.tenant_id
    and active
    and deleted_at is null
  for update;

  if v_reason is null and not found then
    v_reason := 'Produto inativo ou não encontrado neste tenant';
  end if;
  if v_reason is null and v.source_type <> 'manufacturer' then
    v_reason := 'Recuperação automática exige fonte oficial de fabricante';
  end if;
  if v_reason is null and v.confidence < 98 then
    v_reason := 'Confiança abaixo de 98%';
  end if;
  if v_reason is null and not private.product_name_is_storefront_safe(v.suggested_name) then
    v_reason := 'Nome comercial sugerido é inválido';
  end if;
  if v_reason is null and (p.brand_id is null or nullif(btrim(coalesce(p.manufacturer_code,'')),'') is null) then
    v_reason := 'Produto sem marca ou código de fabricante';
  end if;

  v_domain := lower(coalesce(v.specifications->>'source_domain',''));
  v_matched_code := private.normalize_product_code(v.specifications->>'matched_code');
  v_suggested_code := private.normalize_product_code(v.suggested_manufacturer_code);

  if v_reason is null and not exists (
    select 1
    from public.manufacturer_catalog_sources s,
         lateral unnest(coalesce(s.allowed_domains,array[]::text[])) d(domain)
    where s.tenant_id=v.tenant_id
      and s.brand_id=p.brand_id
      and s.status='active'
      and (v_domain=lower(d.domain) or v_domain like '%.' || lower(d.domain))
  ) then
    v_reason := 'Fonte não pertence à whitelist ativa da marca';
  end if;

  if v_reason is null
     and (v_matched_code='' or v_matched_code<>private.normalize_product_code(p.manufacturer_code)) then
    v_reason := 'Código localizado na fonte não coincide exatamente com o código do produto';
  end if;

  if v_reason is null
     and v_suggested_code<>''
     and v_suggested_code<>private.normalize_product_code(p.manufacturer_code) then
    v_reason := 'Código de fabricante sugerido diverge do cadastro';
  end if;

  if v_reason is not null then
    update public.product_enrichment_candidates
    set review_reason=v_reason
    where id=v.id;
    return jsonb_build_object(
      'ok',true,'eligible',false,'candidate_id',v.id,
      'reason',v_reason,'needs_image_copy',false
    );
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'ok',true,'eligible',true,'candidate_id',v.id,
      'needs_image_copy',false,'reason',null
    );
  end if;

  update public.products prod
  set name=btrim(v.suggested_name),
      updated_at=now()
  where prod.id=v.product_id and prod.tenant_id=v.tenant_id;

  update public.product_enrichment_candidates
  set status='approved',
      auto_approved=true,
      review_reason=null,
      reviewed_by=null,
      reviewed_at=now(),
      match_reasons=coalesce(match_reasons,'[]'::jsonb)
        || jsonb_build_array('Autoaprovado somente nome: fonte oficial + código exato + confiança >= 98%')
  where id=v.id;

  update public.product_enrichment_candidates
  set status='rejected',
      reviewed_by=null,
      reviewed_at=now()
  where job_id=v.job_id
    and tenant_id=v.tenant_id
    and id<>v.id
    and status='pending';

  update public.product_enrichment_jobs
  set status='approved',
      approved_by=null,
      approval_mode='auto',
      finished_at=now(),
      last_error=null,
      updated_at=now()
  where id=v.job_id and tenant_id=v.tenant_id;

  return jsonb_build_object(
    'ok',true,
    'eligible',true,
    'candidate_id',v.id,
    'product_id',v.product_id,
    'needs_image_copy',false,
    'name',btrim(v.suggested_name),
    'reason',null
  );
end;
$$;

revoke all on function public.auto_approve_catalog_name_candidate(uuid,boolean)
from public,anon,authenticated;
grant execute on function public.auto_approve_catalog_name_candidate(uuid,boolean)
to service_role;
