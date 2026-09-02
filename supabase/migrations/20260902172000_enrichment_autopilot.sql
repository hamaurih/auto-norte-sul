-- Piloto automático de enriquecimento de catálogo.
-- Mantém aprovação humana existente e adiciona worker service-role com gates conservadores.
begin;

alter table public.product_enrichment_jobs
  add column if not exists approval_mode text;
alter table public.product_enrichment_jobs
  drop constraint if exists product_enrichment_jobs_approval_mode_check;
alter table public.product_enrichment_jobs
  add constraint product_enrichment_jobs_approval_mode_check
  check (approval_mode is null or approval_mode in ('manual','auto'));

alter table public.product_enrichment_jobs
  drop constraint if exists product_enrichment_jobs_trigger_source_check;
alter table public.product_enrichment_jobs
  add constraint product_enrichment_jobs_trigger_source_check
  check (trigger_source in ('manual','product_created','nfe','integration','bulk','auto'));

alter table public.product_enrichment_candidates
  add column if not exists auto_approved boolean not null default false,
  add column if not exists review_reason text;

create table if not exists public.product_enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trigger_source text not null check (trigger_source in ('cron','manual')),
  status text not null default 'running' check (status in ('running','completed','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  enqueued integer not null default 0,
  claimed integer not null default 0,
  processed integer not null default 0,
  auto_approved integer not null default 0,
  sent_review integer not null default 0,
  failed integer not null default 0,
  images_copied integer not null default 0,
  last_error text,
  details jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists product_enrichment_runs_one_running
  on public.product_enrichment_runs(tenant_id) where status = 'running';
create index if not exists product_enrichment_runs_history
  on public.product_enrichment_runs(tenant_id, started_at desc);
create index if not exists product_enrichment_jobs_overview
  on public.product_enrichment_jobs(tenant_id, status, approval_mode, created_at desc);

alter table public.product_enrichment_runs enable row level security;
drop policy if exists product_enrichment_runs_select on public.product_enrichment_runs;
create policy product_enrichment_runs_select on public.product_enrichment_runs
  for select to authenticated
  using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[])));
revoke all on public.product_enrichment_runs from public, anon, authenticated;
grant select on public.product_enrichment_runs to authenticated;
grant all on public.product_enrichment_runs to service_role;

create or replace function private.normalize_product_code(p_value text)
returns text language sql immutable set search_path='' as $$
  select upper(regexp_replace(coalesce(p_value,''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function private.valid_gtin(p_value text)
returns boolean
language plpgsql immutable set search_path=''
as $$
declare
  v text := regexp_replace(coalesce(p_value,''), '\D', '', 'g');
  v_len integer := length(v);
  v_sum integer := 0;
  v_i integer;
  v_digit integer;
  v_check integer;
begin
  if v_len not in (8,12,13,14) then return false; end if;
  for v_i in 1..v_len-1 loop
    v_digit := substr(v, v_i, 1)::integer;
    -- Peso 3 da direita para a esquerda, excluindo o dígito verificador.
    if ((v_len - v_i) % 2) = 1 then
      v_sum := v_sum + (v_digit * 3);
    else
      v_sum := v_sum + v_digit;
    end if;
  end loop;
  v_check := (10 - (v_sum % 10)) % 10;
  return v_check = substr(v, v_len, 1)::integer;
end;
$$;

-- Enfileira apenas produtos que podem ser enriquecidos por fonte oficial cadastrada.
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

-- Recupera jobs presos e reivindica atomicamente um lote devido.
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

  return query
  with picked as (
    select j.id
    from public.product_enrichment_jobs j
    where j.tenant_id = p_tenant_id
      and j.status = 'queued'
      and j.scheduled_at <= now()
      and j.attempts < 3
    order by j.scheduled_at, j.created_at
    for update skip locked
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

create or replace function public.begin_product_enrichment_run(
  p_tenant_id uuid,
  p_trigger text default 'cron'
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
begin
  if p_trigger not in ('cron','manual') then raise exception 'Trigger inválido'; end if;

  update public.product_enrichment_runs
  set status = 'failed', finished_at = now(), last_error = 'Lease expirada'
  where tenant_id = p_tenant_id
    and status = 'running'
    and started_at < now() - interval '15 minutes';

  begin
    insert into public.product_enrichment_runs(tenant_id, trigger_source)
    values (p_tenant_id, p_trigger)
    returning id into v_id;
  exception when unique_violation then
    return null;
  end;
  return v_id;
end;
$$;

create or replace function public.finish_product_enrichment_run(
  p_run_id uuid,
  p_status text,
  p_enqueued integer default 0,
  p_claimed integer default 0,
  p_processed integer default 0,
  p_auto_approved integer default 0,
  p_sent_review integer default 0,
  p_failed integer default 0,
  p_images_copied integer default 0,
  p_last_error text default null,
  p_details jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_status not in ('completed','failed') then raise exception 'Status inválido'; end if;
  update public.product_enrichment_runs
  set status = p_status,
      finished_at = now(),
      enqueued = greatest(coalesce(p_enqueued,0),0),
      claimed = greatest(coalesce(p_claimed,0),0),
      processed = greatest(coalesce(p_processed,0),0),
      auto_approved = greatest(coalesce(p_auto_approved,0),0),
      sent_review = greatest(coalesce(p_sent_review,0),0),
      failed = greatest(coalesce(p_failed,0),0),
      images_copied = greatest(coalesce(p_images_copied,0),0),
      last_error = p_last_error,
      details = coalesce(p_details,'[]'::jsonb)
  where id = p_run_id and status = 'running';
  return found;
end;
$$;

-- Autoaprovação: revalida fonte/código/GTIN/imagens/aplicações dentro do banco.
create or replace function public.auto_approve_product_enrichment_candidate(
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
  p public.products%rowtype;
  v_domain text;
  v_matched_code text;
  v_suggested_code text;
  v_suggested_gtin text;
  v_reason text := null;
  v_gallery_total integer := 0;
  v_gallery_selected integer := 0;
  v_missing_gallery integer := 0;
  v_legacy_needs_copy boolean := false;
  v_bad_apps integer := 0;
  v_has_primary boolean := false;
  v_sort_base integer := 0;
  v_images_added integer := 0;
  v_apps_added integer := 0;
begin
  select * into v from public.product_enrichment_candidates where id = p_candidate_id for update;
  if not found then return jsonb_build_object('ok',false,'eligible',false,'reason','Sugestão não encontrada'); end if;
  if v.status <> 'pending' then return jsonb_build_object('ok',false,'eligible',false,'reason','Sugestão já revisada'); end if;

  select * into p from public.products
  where id = v.product_id and tenant_id = v.tenant_id and active and deleted_at is null
  for update;
  if not found then v_reason := 'Produto inativo ou não encontrado neste tenant'; end if;

  if v_reason is null and v.source_type <> 'manufacturer' then v_reason := 'Autoaprovação exige fonte oficial de fabricante'; end if;
  if v_reason is null and v.confidence < 98 then v_reason := 'Confiança abaixo de 98%'; end if;
  if v_reason is null and (p.brand_id is null or nullif(btrim(coalesce(p.manufacturer_code,'')),'') is null) then
    v_reason := 'Produto sem marca ou código de fabricante';
  end if;

  v_domain := lower(coalesce(v.specifications->>'source_domain',''));
  v_matched_code := private.normalize_product_code(v.specifications->>'matched_code');
  v_suggested_code := private.normalize_product_code(v.suggested_manufacturer_code);
  v_suggested_gtin := regexp_replace(coalesce(v.suggested_gtin,''), '\D', '', 'g');

  if v_reason is null and not exists (
    select 1
    from public.manufacturer_catalog_sources s,
         lateral unnest(coalesce(s.allowed_domains, array[]::text[])) d(domain)
    where s.tenant_id = v.tenant_id
      and s.brand_id = p.brand_id
      and s.status = 'active'
      and (v_domain = lower(d.domain) or v_domain like '%.' || lower(d.domain))
  ) then v_reason := 'Fonte não pertence à whitelist ativa da marca'; end if;

  if v_reason is null and (
    v_matched_code = '' or v_matched_code <> private.normalize_product_code(p.manufacturer_code)
  ) then v_reason := 'Código localizado na fonte não coincide exatamente com o código do produto'; end if;

  if v_reason is null and v_suggested_code <> ''
     and v_suggested_code <> private.normalize_product_code(p.manufacturer_code) then
    v_reason := 'Código de fabricante sugerido diverge do cadastro';
  end if;

  if v_reason is null and v_suggested_gtin <> '' and not private.valid_gtin(v_suggested_gtin) then
    v_reason := 'GTIN sugerido inválido';
  end if;
  if v_reason is null and v_suggested_gtin <> ''
     and nullif(regexp_replace(coalesce(p.gtin,''), '\D', '', 'g'),'') is not null
     and regexp_replace(coalesce(p.gtin,''), '\D', '', 'g') <> v_suggested_gtin then
    v_reason := 'GTIN sugerido diverge do GTIN já cadastrado';
  end if;

  select count(*), count(*) filter (where ci.selected),
         count(*) filter (where ci.selected and ci.storage_url is null)
    into v_gallery_total, v_gallery_selected, v_missing_gallery
  from public.product_enrichment_candidate_images ci
  where ci.tenant_id = v.tenant_id and ci.candidate_id = v.id;

  v_legacy_needs_copy := v_gallery_total = 0 and v.image_url is not null and v.storage_url is null;

  if v_reason is null and (v_gallery_selected > 0 or v.image_url is not null)
     and nullif(btrim(coalesce(v.license_name,'')),'') is null then
    v_reason := 'Uso da imagem não possui autorização/licença registrada';
  end if;

  select count(*) into v_bad_apps
  from public.product_enrichment_candidate_applications ca
  where ca.tenant_id = v.tenant_id
    and ca.candidate_id = v.id
    and ca.selected
    and (
      ca.confidence < 95
      or nullif(btrim(coalesce(ca.vehicle_make,'')),'') is null
      or nullif(btrim(coalesce(ca.vehicle_model,'')),'') is null
      or ca.year_from is null or ca.year_to is null
      or ca.year_from < 1950 or ca.year_to > 2100 or ca.year_from > ca.year_to
    );
  if v_reason is null and v_bad_apps > 0 then v_reason := 'Há aplicação veicular ambígua ou com confiança abaixo de 95%'; end if;

  if v_reason is not null then
    update public.product_enrichment_candidates set review_reason = v_reason where id = v.id;
    return jsonb_build_object('ok',true,'eligible',false,'candidate_id',v.id,'reason',v_reason,'needs_image_copy',false);
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'ok',true,'eligible',true,'candidate_id',v.id,
      'needs_image_copy',(v_missing_gallery > 0 or v_legacy_needs_copy),
      'reason',null
    );
  end if;

  if v_missing_gallery > 0 or v_legacy_needs_copy then
    v_reason := 'Imagem selecionada ainda não foi copiada para o Storage próprio';
    update public.product_enrichment_candidates set review_reason = v_reason where id = v.id;
    return jsonb_build_object('ok',true,'eligible',false,'candidate_id',v.id,'reason',v_reason,'needs_image_copy',true);
  end if;

  -- Campos comerciais (preço/estoque) nunca são tocados.
  update public.products prod set
    name = coalesce(nullif(btrim(v.suggested_name),''), prod.name),
    short_description = coalesce(nullif(btrim(v.suggested_short_description),''), prod.short_description),
    description = coalesce(nullif(btrim(v.suggested_description),''), prod.description),
    gtin = case
      when nullif(btrim(coalesce(prod.gtin,'')),'') is null and v_suggested_gtin <> '' then v_suggested_gtin
      else prod.gtin
    end,
    -- manufacturer_code somente foi validado; não é sobrescrito automaticamente.
    updated_at = now()
  where prod.id = v.product_id and prod.tenant_id = v.tenant_id;

  if v_gallery_selected > 0 then
    select exists (
      select 1 from public.product_images pi
      where pi.tenant_id = v.tenant_id and pi.product_id = v.product_id and pi.is_primary
    ) into v_has_primary;
    select coalesce(max(pi.sort_order), -1) + 1 into v_sort_base
    from public.product_images pi
    where pi.tenant_id = v.tenant_id and pi.product_id = v.product_id;

    with selected_images as (
      select ci.*,
             row_number() over (order by ci.is_primary desc, ci.sort_order, ci.created_at, ci.id) as rn
      from public.product_enrichment_candidate_images ci
      where ci.candidate_id = v.id
        and ci.tenant_id = v.tenant_id
        and ci.selected
        and ci.storage_url is not null
    )
    insert into public.product_images(tenant_id, product_id, url, alt, sort_order, is_primary)
    select v.tenant_id, v.product_id, si.storage_url,
           coalesce(nullif(btrim(si.alt),''), v.suggested_name, p.name),
           v_sort_base + si.rn::integer - 1,
           case when not v_has_primary and si.rn = 1 then true else false end
    from selected_images si
    where not exists (
      select 1 from public.product_images pi
      where pi.tenant_id = v.tenant_id and pi.product_id = v.product_id and pi.url = si.storage_url
    );
    get diagnostics v_images_added = row_count;
  elsif v_gallery_total = 0 and v.storage_url is not null and not exists (
    select 1 from public.product_images pi
    where pi.tenant_id = v.tenant_id and pi.product_id = v.product_id and pi.url = v.storage_url
  ) then
    insert into public.product_images(tenant_id,product_id,url,alt,sort_order,is_primary)
    values(v.tenant_id,v.product_id,v.storage_url,coalesce(v.suggested_name,p.name),0,
      not exists(select 1 from public.product_images pi where pi.tenant_id=v.tenant_id and pi.product_id=v.product_id and pi.is_primary));
    v_images_added := 1;
  end if;

  insert into public.product_applications(tenant_id,product_id,vehicle_make,vehicle_model,year_from,year_to,notes)
  select v.tenant_id,v.product_id,btrim(ca.vehicle_make),btrim(ca.vehicle_model),ca.year_from,ca.year_to,nullif(btrim(ca.notes),'')
  from public.product_enrichment_candidate_applications ca
  where ca.candidate_id = v.id and ca.tenant_id = v.tenant_id and ca.selected
    and ca.confidence >= 95
    and not exists (
      select 1 from public.product_applications pa
      where pa.tenant_id=v.tenant_id and pa.product_id=v.product_id
        and lower(btrim(pa.vehicle_make))=lower(btrim(ca.vehicle_make))
        and lower(btrim(pa.vehicle_model))=lower(btrim(ca.vehicle_model))
        and coalesce(pa.year_from,0)=coalesce(ca.year_from,0)
        and coalesce(pa.year_to,9999)=coalesce(ca.year_to,9999)
    );
  get diagnostics v_apps_added = row_count;

  update public.product_enrichment_candidates
  set status='approved', auto_approved=true, review_reason=null, reviewed_by=null, reviewed_at=now(),
      match_reasons = coalesce(match_reasons,'[]'::jsonb) || jsonb_build_array('Autoaprovado: fonte oficial + código exato + confiança >= 98%')
  where id=v.id;

  update public.product_enrichment_candidates
  set status='rejected', reviewed_by=null, reviewed_at=now()
  where job_id=v.job_id and tenant_id=v.tenant_id and id<>v.id and status='pending';

  update public.product_enrichment_jobs
  set status='approved', approved_by=null, approval_mode='auto', finished_at=now(), last_error=null
  where id=v.job_id and tenant_id=v.tenant_id;

  return jsonb_build_object(
    'ok',true,'eligible',true,'candidate_id',v.id,'product_id',v.product_id,
    'needs_image_copy',false,'images_added',v_images_added,'applications_added',v_apps_added,'reason',null
  );
end;
$$;

-- Reinstala a aprovação humana mais recente, apenas acrescentando auditoria manual.
create or replace function public.approve_product_enrichment_candidate(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.product_enrichment_candidates%rowtype;
  v_user uuid := auth.uid();
  v_gallery_total integer := 0;
  v_gallery_count integer := 0;
  v_missing_gallery integer := 0;
  v_has_primary boolean := false;
  v_sort_base integer := 0;
  v_images_added integer := 0;
  v_apps_added integer := 0;
begin
  select * into v from public.product_enrichment_candidates where id=p_candidate_id for update;
  if not found then raise exception 'Sugestão não encontrada'; end if;
  if v_user is null or not exists (
    select 1 from public.tenant_memberships m where m.tenant_id=v.tenant_id and m.user_id=v_user and m.active and m.role in ('owner','admin','manager')
  ) then raise exception 'Sem permissão para aprovar'; end if;
  if v.status<>'pending' then raise exception 'Sugestão já revisada'; end if;

  select count(*), count(*) filter (where ci.selected)
    into v_gallery_total, v_gallery_count
  from public.product_enrichment_candidate_images ci
  where ci.candidate_id=v.id and ci.tenant_id=v.tenant_id;

  if v_gallery_count>0 then
    select count(*) into v_missing_gallery from public.product_enrichment_candidate_images ci
    where ci.candidate_id=v.id and ci.tenant_id=v.tenant_id and ci.selected and ci.storage_url is null;
    if v_missing_gallery>0 then raise exception 'Copie a galeria selecionada para o armazenamento próprio antes de aprovar'; end if;
  elsif v_gallery_total=0 and v.image_url is not null and v.storage_url is null then
    raise exception 'Copie a imagem para o armazenamento próprio antes de aprovar';
  end if;

  update public.products prod set
    name=coalesce(nullif(btrim(v.suggested_name),''),prod.name),
    short_description=coalesce(nullif(btrim(v.suggested_short_description),''),prod.short_description),
    description=coalesce(nullif(btrim(v.suggested_description),''),prod.description),
    gtin=coalesce(nullif(regexp_replace(v.suggested_gtin,'\D','','g'),''),prod.gtin),
    manufacturer_code=coalesce(nullif(btrim(v.suggested_manufacturer_code),''),prod.manufacturer_code),
    updated_at=now()
  where prod.id=v.product_id and prod.tenant_id=v.tenant_id;

  if v_gallery_count>0 then
    select exists(select 1 from public.product_images pi where pi.tenant_id=v.tenant_id and pi.product_id=v.product_id and pi.is_primary) into v_has_primary;
    select coalesce(max(pi.sort_order),-1)+1 into v_sort_base from public.product_images pi where pi.tenant_id=v.tenant_id and pi.product_id=v.product_id;
    with selected_images as (
      select ci.*, row_number() over(order by ci.is_primary desc,ci.sort_order,ci.created_at,ci.id) rn
      from public.product_enrichment_candidate_images ci
      where ci.candidate_id=v.id and ci.tenant_id=v.tenant_id and ci.selected and ci.storage_url is not null
    )
    insert into public.product_images(tenant_id,product_id,url,alt,sort_order,is_primary)
    select v.tenant_id,v.product_id,si.storage_url,
      coalesce(nullif(btrim(si.alt),''),v.suggested_name,(select name from public.products where id=v.product_id)),
      v_sort_base+si.rn::integer-1,case when not v_has_primary and si.rn=1 then true else false end
    from selected_images si
    where not exists(select 1 from public.product_images pi where pi.tenant_id=v.tenant_id and pi.product_id=v.product_id and pi.url=si.storage_url);
    get diagnostics v_images_added=row_count;
  elsif v_gallery_total=0 and v.storage_url is not null and not exists(
    select 1 from public.product_images i where i.tenant_id=v.tenant_id and i.product_id=v.product_id and i.url=v.storage_url
  ) then
    insert into public.product_images(tenant_id,product_id,url,alt,sort_order,is_primary)
    values(v.tenant_id,v.product_id,v.storage_url,coalesce(v.suggested_name,(select name from public.products where id=v.product_id)),0,
      not exists(select 1 from public.product_images i where i.tenant_id=v.tenant_id and i.product_id=v.product_id and i.is_primary));
    v_images_added:=1;
  end if;

  insert into public.product_applications(tenant_id,product_id,vehicle_make,vehicle_model,year_from,year_to,notes)
  select v.tenant_id,v.product_id,btrim(ca.vehicle_make),btrim(ca.vehicle_model),ca.year_from,ca.year_to,nullif(btrim(ca.notes),'')
  from public.product_enrichment_candidate_applications ca
  where ca.candidate_id=v.id and ca.tenant_id=v.tenant_id and ca.selected
    and not exists(
      select 1 from public.product_applications pa where pa.tenant_id=v.tenant_id and pa.product_id=v.product_id
        and lower(btrim(pa.vehicle_make))=lower(btrim(ca.vehicle_make))
        and lower(btrim(pa.vehicle_model))=lower(btrim(ca.vehicle_model))
        and coalesce(pa.year_from,0)=coalesce(ca.year_from,0)
        and coalesce(pa.year_to,9999)=coalesce(ca.year_to,9999)
    );
  get diagnostics v_apps_added=row_count;

  update public.product_enrichment_candidates
  set status='approved', reviewed_by=v_user, reviewed_at=now(), auto_approved=false, review_reason=null
  where id=v.id;
  update public.product_enrichment_candidates
  set status='rejected', reviewed_by=v_user, reviewed_at=now()
  where job_id=v.job_id and tenant_id=v.tenant_id and id<>v.id and status='pending';
  update public.product_enrichment_jobs
  set status='approved', approved_by=v_user, approval_mode='manual', finished_at=now(), last_error=null
  where id=v.job_id and tenant_id=v.tenant_id;

  return jsonb_build_object('ok',true,'product_id',v.product_id,'candidate_id',v.id,'images_added',v_images_added,'applications_added',v_apps_added,'images_selected',v_gallery_count);
end;
$$;

revoke all on function public.enqueue_product_enrichment_auto(uuid,integer) from public,anon,authenticated;
revoke all on function public.claim_product_enrichment_jobs(uuid,integer) from public,anon,authenticated;
revoke all on function public.begin_product_enrichment_run(uuid,text) from public,anon,authenticated;
revoke all on function public.finish_product_enrichment_run(uuid,text,integer,integer,integer,integer,integer,integer,integer,text,jsonb) from public,anon,authenticated;
revoke all on function public.auto_approve_product_enrichment_candidate(uuid,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_product_enrichment_auto(uuid,integer) to service_role;
grant execute on function public.claim_product_enrichment_jobs(uuid,integer) to service_role;
grant execute on function public.begin_product_enrichment_run(uuid,text) to service_role;
grant execute on function public.finish_product_enrichment_run(uuid,text,integer,integer,integer,integer,integer,integer,integer,text,jsonb) to service_role;
grant execute on function public.auto_approve_product_enrichment_candidate(uuid,boolean) to service_role;

revoke all on function public.approve_product_enrichment_candidate(uuid) from public,anon;
grant execute on function public.approve_product_enrichment_candidate(uuid) to authenticated,service_role;

commit;
