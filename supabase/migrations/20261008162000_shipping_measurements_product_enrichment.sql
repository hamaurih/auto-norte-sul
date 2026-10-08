-- Enriquecimento de peso e dimensões para cálculo de frete.
-- Mantém sugestões separadas do cadastro e só preenche campos vazios após aprovação manual.

alter table public.product_enrichment_candidates
  add column if not exists suggested_weight_kg numeric(10,3),
  add column if not exists suggested_height_cm numeric(10,2),
  add column if not exists suggested_width_cm numeric(10,2),
  add column if not exists suggested_length_cm numeric(10,2),
  add column if not exists measurement_basis text,
  add column if not exists measurement_confidence numeric(5,2);

do $$ begin
  alter table public.product_enrichment_candidates add constraint product_enrichment_candidates_weight_positive check (suggested_weight_kg is null or suggested_weight_kg > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.product_enrichment_candidates add constraint product_enrichment_candidates_height_positive check (suggested_height_cm is null or suggested_height_cm > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.product_enrichment_candidates add constraint product_enrichment_candidates_width_positive check (suggested_width_cm is null or suggested_width_cm > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.product_enrichment_candidates add constraint product_enrichment_candidates_length_positive check (suggested_length_cm is null or suggested_length_cm > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.product_enrichment_candidates add constraint product_enrichment_candidates_measurement_basis_check check (measurement_basis is null or measurement_basis in ('shipping_package','product','unknown'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.product_enrichment_candidates add constraint product_enrichment_candidates_measurement_confidence_check check (measurement_confidence is null or (measurement_confidence >= 0 and measurement_confidence <= 100));
exception when duplicate_object then null; end $$;

create or replace function private.enqueue_products_for_shipping_enrichment(p_tenant_id uuid, p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer;
begin
  if auth.uid() is null or not exists(
    select 1 from public.tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=auth.uid() and m.active and m.role in ('owner','admin','manager')
  ) then raise exception 'Sem permissão para enriquecer produtos'; end if;

  with missing as (
    select p.id, concat_ws(' ','[shipping]',p.gtin,p.manufacturer_code,p.sku,p.name) as query
    from public.products p
    where p.tenant_id=p_tenant_id
      and p.active
      and (p.weight_kg is null or p.weight_kg <= 0 or p.height_cm is null or p.height_cm <= 0 or p.width_cm is null or p.width_cm <= 0 or p.length_cm is null or p.length_cm <= 0)
      and nullif(btrim(coalesce(p.manufacturer_code,'')),'') is not null
      and p.brand_id is not null
      and exists (
        select 1 from public.manufacturer_catalog_sources s
        where s.tenant_id=p.tenant_id and s.brand_id=p.brand_id and s.status='active'
      )
      and not exists(
        select 1 from public.product_enrichment_jobs j
        where j.tenant_id=p.tenant_id and j.product_id=p.id and j.status in ('queued','processing','review')
      )
    order by (nullif(btrim(coalesce(p.gtin,'')),'') is not null) desc,
             (case when p.weight_kg is null or p.weight_kg <= 0 then 1 else 0 end
              + case when p.height_cm is null or p.height_cm <= 0 then 1 else 0 end
              + case when p.width_cm is null or p.width_cm <= 0 then 1 else 0 end
              + case when p.length_cm is null or p.length_cm <= 0 then 1 else 0 end) desc,
             p.updated_at desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  )
  insert into public.product_enrichment_jobs(tenant_id,product_id,trigger_source,status,search_query,created_by,scheduled_at)
  select p_tenant_id,id,'bulk','queued',query,auth.uid(),now() from missing;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.enqueue_products_for_shipping_enrichment(p_tenant_id uuid, p_limit integer default 100)
returns integer
language sql
set search_path=''
as $$ select private.enqueue_products_for_shipping_enrichment($1,$2); $$;

revoke all on function public.enqueue_products_for_shipping_enrichment(uuid,integer) from public, anon;
grant execute on function public.enqueue_products_for_shipping_enrichment(uuid,integer) to authenticated;

-- O worker antigo não pode consumir jobs do piloto de frete.
create or replace function public.claim_product_enrichment_jobs(p_tenant_id uuid, p_limit integer default 2)
returns table(job_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.product_enrichment_jobs j
  set status='failed', finished_at=now(), last_error='Worker excedeu o tempo máximo após 3 tentativas'
  where j.tenant_id=p_tenant_id and j.status='processing'
    and coalesce(j.search_query,'') not like '[shipping]%'
    and j.started_at < now()-interval '20 minutes' and j.attempts>=3;

  update public.product_enrichment_jobs j
  set status='queued', started_at=null, scheduled_at=now()+interval '15 minutes', last_error='Worker anterior expirou; job reagendado'
  where j.tenant_id=p_tenant_id and j.status='processing'
    and coalesce(j.search_query,'') not like '[shipping]%'
    and j.started_at < now()-interval '20 minutes' and j.attempts<3;

  return query
  with picked as (
    select j.id from public.product_enrichment_jobs j
    where j.tenant_id=p_tenant_id and j.status='queued' and j.scheduled_at<=now() and j.attempts<3
      and coalesce(j.search_query,'') not like '[shipping]%'
    order by j.scheduled_at,j.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,2),5))
  ), claimed as (
    update public.product_enrichment_jobs j
    set status='processing',started_at=now(),finished_at=null,attempts=j.attempts+1,last_error=null
    from picked p where j.id=p.id
    returning j.id,j.tenant_id
  )
  select c.id,c.tenant_id from claimed c;
end;
$$;

create or replace function public.claim_shipping_enrichment_jobs(p_tenant_id uuid, p_limit integer default 2)
returns table(job_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.product_enrichment_jobs j
  set status='failed', finished_at=now(), last_error='Worker de peso/medidas excedeu o tempo máximo após 3 tentativas'
  where j.tenant_id=p_tenant_id and j.status='processing'
    and coalesce(j.search_query,'') like '[shipping]%'
    and j.started_at < now()-interval '20 minutes' and j.attempts>=3;

  update public.product_enrichment_jobs j
  set status='queued', started_at=null, scheduled_at=now()+interval '15 minutes', last_error='Worker de peso/medidas expirou; job reagendado'
  where j.tenant_id=p_tenant_id and j.status='processing'
    and coalesce(j.search_query,'') like '[shipping]%'
    and j.started_at < now()-interval '20 minutes' and j.attempts<3;

  return query
  with picked as (
    select j.id from public.product_enrichment_jobs j
    where j.tenant_id=p_tenant_id and j.status='queued' and j.scheduled_at<=now() and j.attempts<3
      and coalesce(j.search_query,'') like '[shipping]%'
    order by (case when j.search_query ~ '[0-9]{8,14}' then 0 else 1 end), j.scheduled_at,j.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,2),5))
  ), claimed as (
    update public.product_enrichment_jobs j
    set status='processing',started_at=now(),finished_at=null,attempts=j.attempts+1,last_error=null
    from picked p where j.id=p.id
    returning j.id,j.tenant_id
  )
  select c.id,c.tenant_id from claimed c;
end;
$$;

revoke all on function public.claim_shipping_enrichment_jobs(uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_shipping_enrichment_jobs(uuid,integer) to service_role;

create or replace function private.approve_shipping_enrichment_candidate(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.product_enrichment_candidates%rowtype;
  v_user uuid := auth.uid();
  v_query text;
  v_product public.products%rowtype;
  v_applied integer := 0;
begin
  select c.* into v from public.product_enrichment_candidates c where c.id=p_candidate_id for update;
  if not found then raise exception 'Sugestão não encontrada'; end if;

  select j.search_query into v_query from public.product_enrichment_jobs j where j.id=v.job_id and j.tenant_id=v.tenant_id;
  if coalesce(v_query,'') not like '[shipping]%' then raise exception 'Esta sugestão não pertence ao enriquecimento de frete'; end if;

  if v_user is null or not exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id=v.tenant_id and m.user_id=v_user and m.active and m.role in ('owner','admin','manager')
  ) then raise exception 'Sem permissão para aprovar'; end if;
  if v.status<>'pending' then raise exception 'Sugestão já revisada'; end if;

  select * into v_product from public.products p where p.id=v.product_id and p.tenant_id=v.tenant_id for update;
  if not found then raise exception 'Produto não encontrado'; end if;

  v_applied :=
    (case when (v_product.weight_kg is null or v_product.weight_kg<=0) and v.suggested_weight_kg is not null and v.suggested_weight_kg>0 then 1 else 0 end) +
    (case when (v_product.height_cm is null or v_product.height_cm<=0) and v.suggested_height_cm is not null and v.suggested_height_cm>0 then 1 else 0 end) +
    (case when (v_product.width_cm is null or v_product.width_cm<=0) and v.suggested_width_cm is not null and v.suggested_width_cm>0 then 1 else 0 end) +
    (case when (v_product.length_cm is null or v_product.length_cm<=0) and v.suggested_length_cm is not null and v.suggested_length_cm>0 then 1 else 0 end);

  update public.products p set
    weight_kg=case when (p.weight_kg is null or p.weight_kg<=0) and v.suggested_weight_kg is not null and v.suggested_weight_kg>0 then v.suggested_weight_kg else p.weight_kg end,
    height_cm=case when (p.height_cm is null or p.height_cm<=0) and v.suggested_height_cm is not null and v.suggested_height_cm>0 then v.suggested_height_cm else p.height_cm end,
    width_cm=case when (p.width_cm is null or p.width_cm<=0) and v.suggested_width_cm is not null and v.suggested_width_cm>0 then v.suggested_width_cm else p.width_cm end,
    length_cm=case when (p.length_cm is null or p.length_cm<=0) and v.suggested_length_cm is not null and v.suggested_length_cm>0 then v.suggested_length_cm else p.length_cm end,
    updated_at=now()
  where p.id=v.product_id and p.tenant_id=v.tenant_id;

  update public.product_enrichment_candidates
  set status='approved',reviewed_by=v_user,reviewed_at=now(),auto_approved=false,review_reason=null
  where id=v.id;
  update public.product_enrichment_candidates
  set status='rejected',reviewed_by=v_user,reviewed_at=now()
  where job_id=v.job_id and tenant_id=v.tenant_id and id<>v.id and status='pending';
  update public.product_enrichment_jobs
  set status='approved',approved_by=v_user,approval_mode='manual',finished_at=now(),last_error=null
  where id=v.job_id and tenant_id=v.tenant_id;

  return jsonb_build_object('ok',true,'product_id',v.product_id,'candidate_id',v.id,'shipping_fields_applied',v_applied);
end;
$$;

create or replace function public.approve_shipping_enrichment_candidate(p_candidate_id uuid)
returns jsonb
language sql
set search_path=''
as $$ select private.approve_shipping_enrichment_candidate($1); $$;

revoke all on function public.approve_shipping_enrichment_candidate(uuid) from public, anon;
grant execute on function public.approve_shipping_enrichment_candidate(uuid) to authenticated;

create index if not exists product_enrichment_jobs_shipping_queue_idx
on public.product_enrichment_jobs(tenant_id,status,scheduled_at,created_at)
where status='queued' and search_query like '[shipping]%';
