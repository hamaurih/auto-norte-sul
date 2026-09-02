-- Evita que o worker automático consuma jobs sem os pré-requisitos mínimos.
-- Jobs legados inválidos são encerrados com motivo auditável; assim que o
-- cadastro for corrigido, podem ser reenfileirados sem esperar o cooldown.
begin;

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
  with eligible as (
    select p.id,
           concat_ws(' ', nullif(p.gtin,''), nullif(p.manufacturer_code,''), nullif(p.sku,''), p.name) as search_query
    from public.products p
    where p.tenant_id = p_tenant_id
      and p.active
      and p.deleted_at is null
      and p.brand_id is not null
      and nullif(btrim(coalesce(p.manufacturer_code,'')), '') is not null
      and exists (
        select 1 from public.manufacturer_catalog_sources s
        where s.tenant_id = p.tenant_id
          and s.brand_id = p.brand_id
          and s.status = 'active'
      )
      and (
        nullif(btrim(coalesce(p.gtin,'')), '') is null
        or nullif(btrim(coalesce(p.description,'')), '') is null
        or not exists (
          select 1 from public.product_images pi
          where pi.tenant_id = p.tenant_id
            and pi.product_id = p.id
            and pi.url like '%/storage/v1/object/public/product-images/%'
        )
        or not exists (
          select 1 from public.product_applications pa
          where pa.tenant_id = p.tenant_id and pa.product_id = p.id
        )
      )
      and not exists (
        select 1 from public.product_enrichment_jobs j
        where j.tenant_id = p.tenant_id
          and j.product_id = p.id
          and j.status in ('queued','processing','review')
      )
      and not exists (
        select 1 from public.product_enrichment_jobs jf
        where jf.tenant_id = p.tenant_id
          and jf.product_id = p.id
          and jf.status = 'failed'
          and jf.finished_at > now() - interval '14 days'
          and coalesce(jf.last_error,'') not like 'Pré-requisito de enriquecimento ausente:%'
      )
    order by
      case when not exists (
        select 1 from public.product_images pi
        where pi.tenant_id = p.tenant_id
          and pi.product_id = p.id
          and pi.url like '%/storage/v1/object/public/product-images/%'
      ) then 0 else 1 end,
      p.updated_at desc
    limit greatest(1, least(coalesce(p_limit,25),100))
  )
  insert into public.product_enrichment_jobs(
    tenant_id, product_id, trigger_source, status, search_query, scheduled_at, created_by
  )
  select p_tenant_id, e.id, 'auto', 'queued', e.search_query, now(), null
  from eligible e
  on conflict (tenant_id, product_id)
    where status in ('queued','processing','review')
  do nothing;

  get diagnostics v_count = row_count;
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
  -- Recupera workers interrompidos.
  update public.product_enrichment_jobs j
  set status = 'failed',
      finished_at = now(),
      last_error = 'Worker excedeu o tempo máximo após 3 tentativas'
  where j.tenant_id = p_tenant_id
    and j.status = 'processing'
    and j.started_at < now() - interval '20 minutes'
    and j.attempts >= 3;

  update public.product_enrichment_jobs j
  set status = 'queued',
      started_at = null,
      scheduled_at = now() + interval '15 minutes',
      last_error = 'Worker anterior expirou; job reagendado'
  where j.tenant_id = p_tenant_id
    and j.status = 'processing'
    and j.started_at < now() - interval '20 minutes'
    and j.attempts < 3;

  -- Jobs legados que não podem ser enriquecidos com segurança não são enviados
  -- ao crawler. O motivo é auditável e não ativa o cooldown técnico de 14 dias.
  update public.product_enrichment_jobs j
  set status = 'failed',
      finished_at = now(),
      last_error = 'Pré-requisito de enriquecimento ausente: produto ativo, marca e código do fabricante são obrigatórios'
  where j.tenant_id = p_tenant_id
    and j.status = 'queued'
    and j.scheduled_at <= now()
    and not exists (
      select 1 from public.products p
      where p.id = j.product_id
        and p.tenant_id = j.tenant_id
        and p.active
        and p.deleted_at is null
        and p.brand_id is not null
        and nullif(btrim(coalesce(p.manufacturer_code,'')), '') is not null
    );

  update public.product_enrichment_jobs j
  set status = 'failed',
      finished_at = now(),
      last_error = 'Pré-requisito de enriquecimento ausente: nenhuma fonte oficial ativa cadastrada para a marca'
  where j.tenant_id = p_tenant_id
    and j.status = 'queued'
    and j.scheduled_at <= now()
    and exists (
      select 1 from public.products p
      where p.id = j.product_id
        and p.tenant_id = j.tenant_id
        and p.active
        and p.deleted_at is null
        and p.brand_id is not null
        and nullif(btrim(coalesce(p.manufacturer_code,'')), '') is not null
    )
    and not exists (
      select 1
      from public.products p
      join public.manufacturer_catalog_sources s
        on s.tenant_id = p.tenant_id
       and s.brand_id = p.brand_id
       and s.status = 'active'
      where p.id = j.product_id
        and p.tenant_id = j.tenant_id
    );

  return query
  with picked as (
    select j.id
    from public.product_enrichment_jobs j
    join public.products p
      on p.id = j.product_id
     and p.tenant_id = j.tenant_id
    where j.tenant_id = p_tenant_id
      and j.status = 'queued'
      and j.scheduled_at <= now()
      and j.attempts < 3
      and p.active
      and p.deleted_at is null
      and p.brand_id is not null
      and nullif(btrim(coalesce(p.manufacturer_code,'')), '') is not null
      and exists (
        select 1 from public.manufacturer_catalog_sources s
        where s.tenant_id = p.tenant_id
          and s.brand_id = p.brand_id
          and s.status = 'active'
      )
    order by j.scheduled_at, j.created_at
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit,2),5))
  ), claimed as (
    update public.product_enrichment_jobs j
    set status = 'processing',
        started_at = now(),
        finished_at = null,
        attempts = j.attempts + 1,
        last_error = null
    from picked p
    where j.id = p.id
    returning j.id, j.tenant_id
  )
  select c.id, c.tenant_id from claimed c;
end;
$$;

revoke all on function public.enqueue_product_enrichment_auto(uuid,integer) from public, anon, authenticated;
revoke all on function public.claim_product_enrichment_jobs(uuid,integer) from public, anon, authenticated;
grant execute on function public.enqueue_product_enrichment_auto(uuid,integer) to service_role;
grant execute on function public.claim_product_enrichment_jobs(uuid,integer) to service_role;

commit;
