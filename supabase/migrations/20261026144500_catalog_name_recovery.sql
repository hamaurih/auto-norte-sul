-- Priority recovery for products whose storefront name is invalid.
-- Uses only existing official manufacturer sources and keeps publication manual/explicit.

create or replace function private.guard_catalog_name_candidate_approval()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='approved'
     and old.status is distinct from new.status
     and exists (
       select 1
       from public.product_enrichment_jobs j
       where j.id=new.job_id
         and j.tenant_id=new.tenant_id
         and coalesce(j.search_query,'') like '[catalog-name]%'
     )
     and not private.product_name_is_storefront_safe(new.suggested_name)
  then
    raise exception 'Recuperação de catálogo exige nome comercial válido vindo da fonte aprovada';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_catalog_name_candidate_approval on public.product_enrichment_candidates;
create trigger trg_guard_catalog_name_candidate_approval
before update of status on public.product_enrichment_candidates
for each row
execute function private.guard_catalog_name_candidate_approval();

create or replace function public.enqueue_product_enrichment_auto(
  p_tenant_id uuid,
  p_limit integer default 25
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer := 0;
begin
  -- Retag existing active jobs so the recovery queue receives priority.
  update public.product_enrichment_jobs j
  set search_query = '[catalog-name] ' || concat_ws(
        ' ',
        nullif(p.gtin,''),
        nullif(p.manufacturer_code,''),
        nullif(p.sku,''),
        p.name
      ),
      scheduled_at = least(j.scheduled_at, now()),
      updated_at = now()
  from public.products p
  where j.tenant_id=p_tenant_id
    and j.tenant_id=p.tenant_id
    and j.product_id=p.id
    and j.status in ('queued','review')
    and coalesce(j.search_query,'') not like '[shipping]%'
    and not private.product_name_is_storefront_safe(p.name)
    and p.active
    and p.deleted_at is null
    and p.brand_id is not null
    and nullif(btrim(coalesce(p.manufacturer_code,'')), '') is not null
    and exists (
      select 1
      from public.manufacturer_catalog_sources s
      where s.tenant_id=p.tenant_id
        and s.brand_id=p.brand_id
        and s.status='active'
    );

  with eligible as (
    select
      p.id,
      not private.product_name_is_storefront_safe(p.name) as needs_name,
      case
        when not private.product_name_is_storefront_safe(p.name)
          then '[catalog-name] ' || concat_ws(
            ' ',
            nullif(p.gtin,''),
            nullif(p.manufacturer_code,''),
            nullif(p.sku,''),
            p.name
          )
        else concat_ws(
          ' ',
          nullif(p.gtin,''),
          nullif(p.manufacturer_code,''),
          nullif(p.sku,''),
          p.name
        )
      end as search_query
    from public.products p
    where p.tenant_id=p_tenant_id
      and p.active
      and p.deleted_at is null
      and p.brand_id is not null
      and nullif(btrim(coalesce(p.manufacturer_code,'')), '') is not null
      and exists (
        select 1
        from public.manufacturer_catalog_sources s
        where s.tenant_id=p.tenant_id
          and s.brand_id=p.brand_id
          and s.status='active'
      )
      and (
        not private.product_name_is_storefront_safe(p.name)
        or nullif(btrim(coalesce(p.gtin,'')), '') is null
        or nullif(btrim(coalesce(p.description,'')), '') is null
        or not exists (
          select 1 from public.product_images pi
          where pi.tenant_id=p.tenant_id
            and pi.product_id=p.id
            and pi.url like '%/storage/v1/object/public/product-images/%'
        )
        or not exists (
          select 1 from public.product_applications pa
          where pa.tenant_id=p.tenant_id and pa.product_id=p.id
        )
      )
      and not exists (
        select 1
        from public.product_enrichment_jobs j
        where j.tenant_id=p.tenant_id
          and j.product_id=p.id
          and j.status in ('queued','processing','review')
      )
      and not exists (
        select 1
        from public.product_enrichment_jobs jf
        where jf.tenant_id=p.tenant_id
          and jf.product_id=p.id
          and jf.status='failed'
          and jf.finished_at > now() - (
            case
              when not private.product_name_is_storefront_safe(p.name)
                then interval '24 hours'
              else interval '14 days'
            end
          )
      )
    order by
      case when not private.product_name_is_storefront_safe(p.name) then 0 else 1 end,
      case when not exists (
        select 1 from public.product_images pi
        where pi.tenant_id=p.tenant_id
          and pi.product_id=p.id
          and pi.url like '%/storage/v1/object/public/product-images/%'
      ) then 0 else 1 end,
      p.updated_at desc
    limit greatest(1,least(coalesce(p_limit,25),100))
  )
  insert into public.product_enrichment_jobs(
    tenant_id,product_id,trigger_source,status,search_query,scheduled_at,created_by
  )
  select p_tenant_id,e.id,'auto','queued',e.search_query,now(),null
  from eligible e
  on conflict (tenant_id,product_id)
    where status in ('queued','processing','review')
  do nothing;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.claim_product_enrichment_jobs(
  p_tenant_id uuid,
  p_limit integer default 2
)
returns table(job_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.product_enrichment_jobs j
  set status='failed',
      finished_at=now(),
      last_error='Worker excedeu o tempo máximo após 3 tentativas'
  where j.tenant_id=p_tenant_id
    and j.status='processing'
    and coalesce(j.search_query,'') not like '[shipping]%'
    and j.started_at < now()-interval '20 minutes'
    and j.attempts>=3;

  update public.product_enrichment_jobs j
  set status='queued',
      started_at=null,
      scheduled_at=now()+interval '15 minutes',
      last_error='Worker anterior expirou; job reagendado'
  where j.tenant_id=p_tenant_id
    and j.status='processing'
    and coalesce(j.search_query,'') not like '[shipping]%'
    and j.started_at < now()-interval '20 minutes'
    and j.attempts<3;

  return query
  with picked as (
    select j.id
    from public.product_enrichment_jobs j
    where j.tenant_id=p_tenant_id
      and j.status='queued'
      and j.scheduled_at<=now()
      and j.attempts<3
      and coalesce(j.search_query,'') not like '[shipping]%'
    order by
      case when coalesce(j.search_query,'') like '[catalog-name]%' then 0 else 1 end,
      j.scheduled_at,
      j.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,2),5))
  ),
  claimed as (
    update public.product_enrichment_jobs j
    set status='processing',
        started_at=now(),
        finished_at=null,
        attempts=j.attempts+1,
        last_error=null
    from picked p
    where j.id=p.id
    returning j.id,j.tenant_id
  )
  select c.id,c.tenant_id from claimed c;
end;
$$;

create or replace function private.enqueue_products_for_enrichment(
  p_tenant_id uuid,
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null
     or not private.has_tenant_role(p_tenant_id,array['owner','admin','manager'])
  then
    raise exception 'Sem permissão para enriquecer produtos';
  end if;

  with missing as (
    select
      p.id,
      case
        when not private.product_name_is_storefront_safe(p.name)
          then '[catalog-name] ' || concat_ws(' ',p.gtin,p.manufacturer_code,p.sku,p.name)
        else concat_ws(' ',p.gtin,p.manufacturer_code,p.sku,p.name)
      end as query
    from public.products p
    where p.tenant_id=p_tenant_id
      and p.active
      and p.deleted_at is null
      and (
        not private.product_name_is_storefront_safe(p.name)
        or nullif(btrim(coalesce(p.description,'')),'') is null
        or not exists (
          select 1
          from public.product_images i
          where i.tenant_id=p.tenant_id and i.product_id=p.id
        )
      )
      and not exists (
        select 1
        from public.product_enrichment_jobs j
        where j.tenant_id=p.tenant_id
          and j.product_id=p.id
          and j.status in ('queued','processing','review')
      )
    order by
      case when not private.product_name_is_storefront_safe(p.name) then 0 else 1 end,
      p.updated_at desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  )
  insert into public.product_enrichment_jobs(
    tenant_id,product_id,trigger_source,search_query,created_by
  )
  select p_tenant_id,id,'bulk',query,auth.uid()
  from missing;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.get_product_name_recovery_overview(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_invalid integer:=0;
  v_queued integer:=0;
  v_processing integer:=0;
  v_review integer:=0;
  v_approved integer:=0;
  v_ready integer:=0;
  v_published integer:=0;
begin
  if auth.uid() is null
     or not private.has_tenant_role(p_tenant_id,array['owner','admin','manager'])
  then
    raise exception 'Sem permissão para acompanhar recuperação do catálogo';
  end if;

  select count(*) into v_invalid
  from public.products p
  where p.tenant_id=p_tenant_id
    and p.active
    and p.deleted_at is null
    and not private.product_name_is_storefront_safe(p.name);

  select
    count(*) filter (where j.status='queued'),
    count(*) filter (where j.status='processing'),
    count(*) filter (where j.status='review'),
    count(*) filter (where j.status='approved')
  into v_queued,v_processing,v_review,v_approved
  from public.product_enrichment_jobs j
  where j.tenant_id=p_tenant_id
    and coalesce(j.search_query,'') like '[catalog-name]%';

  select count(distinct p.id) into v_ready
  from public.products p
  where p.tenant_id=p_tenant_id
    and p.active
    and p.deleted_at is null
    and p.available_for_online=false
    and private.product_name_is_storefront_safe(p.name)
    and coalesce(p.price_b2c,0)>0
    and coalesce(p.stock,0)>0
    and p.brand_id is not null
    and p.category_id is not null
    and exists (
      select 1
      from public.product_enrichment_jobs j
      where j.tenant_id=p.tenant_id
        and j.product_id=p.id
        and j.status='approved'
        and coalesce(j.search_query,'') like '[catalog-name]%'
    );

  select count(distinct p.id) into v_published
  from public.products p
  where p.tenant_id=p_tenant_id
    and p.available_for_online=true
    and private.product_name_is_storefront_safe(p.name)
    and exists (
      select 1
      from public.product_enrichment_jobs j
      where j.tenant_id=p.tenant_id
        and j.product_id=p.id
        and j.status='approved'
        and coalesce(j.search_query,'') like '[catalog-name]%'
    );

  return jsonb_build_object(
    'invalidRemaining',v_invalid,
    'queued',v_queued,
    'processing',v_processing,
    'review',v_review,
    'approved',v_approved,
    'readyToPublish',v_ready,
    'published',v_published
  );
end;
$$;

create or replace function private.publish_recovered_product(p_tenant_id uuid,p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  p public.products%rowtype;
begin
  if v_user is null
     or not private.has_tenant_role(p_tenant_id,array['owner','admin','manager'])
  then
    raise exception 'Sem permissão para publicar produto recuperado';
  end if;

  select *
  into p
  from public.products
  where tenant_id=p_tenant_id and id=p_product_id
  for update;

  if not found then raise exception 'Produto não encontrado'; end if;
  if not p.active or p.deleted_at is not null then raise exception 'Produto inativo'; end if;
  if not private.product_name_is_storefront_safe(p.name) then raise exception 'Nome comercial ainda não foi recuperado'; end if;
  if coalesce(p.price_b2c,0)<=0 then raise exception 'Produto sem preço B2C válido'; end if;
  if coalesce(p.stock,0)<=0 then raise exception 'Produto sem estoque disponível'; end if;
  if p.brand_id is null then raise exception 'Produto sem marca'; end if;
  if p.category_id is null then raise exception 'Produto sem categoria principal'; end if;

  if not exists (
    select 1
    from public.product_enrichment_jobs j
    where j.tenant_id=p_tenant_id
      and j.product_id=p_product_id
      and j.status='approved'
      and coalesce(j.search_query,'') like '[catalog-name]%'
  ) then
    raise exception 'Produto ainda não possui recuperação de nome aprovada';
  end if;

  update public.products
  set available_for_online=true,
      ecommerce_approved_by=v_user,
      ecommerce_approved_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_product_id;

  return jsonb_build_object(
    'ok',true,
    'product_id',p_product_id,
    'name',p.name,
    'published',true
  );
end;
$$;

create or replace function public.publish_recovered_product(p_tenant_id uuid,p_product_id uuid)
returns jsonb
language sql
set search_path=''
as $$
  select private.publish_recovered_product($1,$2);
$$;

revoke all on function private.guard_catalog_name_candidate_approval() from public,anon,authenticated;
revoke all on function public.get_product_name_recovery_overview(uuid) from public,anon;
grant execute on function public.get_product_name_recovery_overview(uuid) to authenticated;
revoke all on function private.publish_recovered_product(uuid,uuid) from public,anon,authenticated;
revoke all on function public.publish_recovered_product(uuid,uuid) from public,anon;
grant execute on function public.publish_recovered_product(uuid,uuid) to authenticated;

-- Seed and prioritize the current recovery campaign without duplicating active work.
update public.product_enrichment_jobs j
set search_query='[catalog-name] ' || concat_ws(
      ' ',
      nullif(p.gtin,''),
      nullif(p.manufacturer_code,''),
      nullif(p.sku,''),
      p.name
    ),
    scheduled_at=least(j.scheduled_at,now()),
    updated_at=now()
from public.products p
where j.tenant_id=p.tenant_id
  and j.product_id=p.id
  and j.status in ('queued','review')
  and coalesce(j.search_query,'') not like '[shipping]%'
  and not private.product_name_is_storefront_safe(p.name)
  and p.active
  and p.deleted_at is null
  and p.brand_id is not null
  and nullif(btrim(coalesce(p.manufacturer_code,'')), '') is not null
  and exists (
    select 1
    from public.manufacturer_catalog_sources s
    where s.tenant_id=p.tenant_id
      and s.brand_id=p.brand_id
      and s.status='active'
  );

insert into public.product_enrichment_jobs(
  tenant_id,product_id,trigger_source,status,search_query,scheduled_at,created_by
)
select
  p.tenant_id,
  p.id,
  'auto',
  'queued',
  '[catalog-name] ' || concat_ws(
    ' ',
    nullif(p.gtin,''),
    nullif(p.manufacturer_code,''),
    nullif(p.sku,''),
    p.name
  ),
  now(),
  null
from public.products p
join public.tenants target_tenant on target_tenant.id=p.tenant_id
where target_tenant.slug='norte-sul-real'
  and target_tenant.environment='production'
  and p.active
  and p.deleted_at is null
  and not private.product_name_is_storefront_safe(p.name)
  and p.brand_id is not null
  and nullif(btrim(coalesce(p.manufacturer_code,'')), '') is not null
  and exists (
    select 1
    from public.manufacturer_catalog_sources s
    where s.tenant_id=p.tenant_id
      and s.brand_id=p.brand_id
      and s.status='active'
  )
  and not exists (
    select 1
    from public.product_enrichment_jobs j
    where j.tenant_id=p.tenant_id
      and j.product_id=p.id
      and j.status in ('queued','processing','review')
  );
