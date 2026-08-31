-- Galeria completa e aplicações veiculares auditáveis para o enriquecimento de catálogo.
begin;

create table if not exists public.product_enrichment_candidate_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  candidate_id uuid not null references public.product_enrichment_candidates(id) on delete cascade,
  product_id uuid not null,
  source_url text not null,
  storage_url text,
  alt text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_primary boolean not null default false,
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_enrichment_candidate_images_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade,
  constraint product_enrichment_candidate_images_candidate_url_key unique (candidate_id, source_url)
);

create index if not exists product_enrichment_candidate_images_candidate_idx
  on public.product_enrichment_candidate_images (tenant_id, candidate_id, selected, sort_order);

create table if not exists public.product_enrichment_candidate_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  candidate_id uuid not null references public.product_enrichment_candidates(id) on delete cascade,
  product_id uuid not null,
  vehicle_make text not null,
  vehicle_model text not null,
  year_from integer,
  year_to integer,
  notes text,
  source_text text,
  confidence numeric(5,2) not null default 95 check (confidence between 0 and 100),
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_enrichment_candidate_applications_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade,
  constraint product_enrichment_candidate_applications_years_check
    check (year_from is null or year_to is null or year_from <= year_to)
);

create unique index if not exists product_enrichment_candidate_applications_unique_idx
  on public.product_enrichment_candidate_applications (
    candidate_id,
    lower(vehicle_make),
    lower(vehicle_model),
    coalesce(year_from, 0),
    coalesce(year_to, 9999)
  );

create index if not exists product_enrichment_candidate_applications_candidate_idx
  on public.product_enrichment_candidate_applications (tenant_id, candidate_id, selected);

alter table public.product_enrichment_candidate_images enable row level security;
alter table public.product_enrichment_candidate_applications enable row level security;

drop policy if exists product_enrichment_candidate_images_select on public.product_enrichment_candidate_images;
create policy product_enrichment_candidate_images_select
  on public.product_enrichment_candidate_images for select to authenticated
  using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[])));

drop policy if exists product_enrichment_candidate_applications_select on public.product_enrichment_candidate_applications;
create policy product_enrichment_candidate_applications_select
  on public.product_enrichment_candidate_applications for select to authenticated
  using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[])));

revoke all on public.product_enrichment_candidate_images, public.product_enrichment_candidate_applications from anon;
revoke insert, update, delete on public.product_enrichment_candidate_images, public.product_enrichment_candidate_applications from authenticated;
grant select on public.product_enrichment_candidate_images, public.product_enrichment_candidate_applications to authenticated;
grant all on public.product_enrichment_candidate_images, public.product_enrichment_candidate_applications to service_role;

create or replace function public.approve_product_enrichment_candidate(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.product_enrichment_candidates%rowtype;
  v_user uuid := auth.uid();
  v_gallery_count integer := 0;
  v_missing_gallery integer := 0;
  v_has_primary boolean := false;
  v_sort_base integer := 0;
  v_images_added integer := 0;
  v_apps_added integer := 0;
begin
  select * into v
  from public.product_enrichment_candidates
  where id = p_candidate_id
  for update;

  if not found then raise exception 'Sugestão não encontrada'; end if;

  if v_user is null or not exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = v.tenant_id
      and m.user_id = v_user
      and m.active
      and m.role in ('owner','admin','manager')
  ) then
    raise exception 'Sem permissão para aprovar';
  end if;

  if v.status <> 'pending' then raise exception 'Sugestão já revisada'; end if;

  select count(*) into v_gallery_count
  from public.product_enrichment_candidate_images ci
  where ci.candidate_id = v.id and ci.tenant_id = v.tenant_id and ci.selected;

  if v_gallery_count > 0 then
    select count(*) into v_missing_gallery
    from public.product_enrichment_candidate_images ci
    where ci.candidate_id = v.id
      and ci.tenant_id = v.tenant_id
      and ci.selected
      and ci.storage_url is null;
    if v_missing_gallery > 0 then
      raise exception 'Copie a galeria selecionada para o armazenamento próprio antes de aprovar';
    end if;
  elsif v.image_url is not null and v.storage_url is null then
    raise exception 'Copie a imagem para o armazenamento próprio antes de aprovar';
  end if;

  update public.products p set
    name = coalesce(nullif(btrim(v.suggested_name), ''), p.name),
    short_description = coalesce(nullif(btrim(v.suggested_short_description), ''), p.short_description),
    description = coalesce(nullif(btrim(v.suggested_description), ''), p.description),
    gtin = coalesce(nullif(regexp_replace(v.suggested_gtin, '\D', '', 'g'), ''), p.gtin),
    manufacturer_code = coalesce(nullif(btrim(v.suggested_manufacturer_code), ''), p.manufacturer_code),
    updated_at = now()
  where p.id = v.product_id and p.tenant_id = v.tenant_id;

  if v_gallery_count > 0 then
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
    insert into public.product_images (tenant_id, product_id, url, alt, sort_order, is_primary)
    select
      v.tenant_id,
      v.product_id,
      si.storage_url,
      coalesce(nullif(btrim(si.alt), ''), v.suggested_name, (select name from public.products where id = v.product_id)),
      v_sort_base + si.rn::integer - 1,
      case when not v_has_primary and si.rn = 1 then true else false end
    from selected_images si
    where not exists (
      select 1 from public.product_images pi
      where pi.tenant_id = v.tenant_id
        and pi.product_id = v.product_id
        and pi.url = si.storage_url
    );
    get diagnostics v_images_added = row_count;
  elsif v.storage_url is not null and not exists (
    select 1 from public.product_images i
    where i.tenant_id = v.tenant_id and i.product_id = v.product_id and i.url = v.storage_url
  ) then
    insert into public.product_images (tenant_id, product_id, url, alt, sort_order, is_primary)
    values (
      v.tenant_id,
      v.product_id,
      v.storage_url,
      coalesce(v.suggested_name, (select name from public.products where id = v.product_id)),
      0,
      not exists (
        select 1 from public.product_images i
        where i.tenant_id = v.tenant_id and i.product_id = v.product_id and i.is_primary
      )
    );
    v_images_added := 1;
  end if;

  insert into public.product_applications (
    tenant_id, product_id, vehicle_make, vehicle_model, year_from, year_to, notes
  )
  select
    v.tenant_id,
    v.product_id,
    btrim(ca.vehicle_make),
    btrim(ca.vehicle_model),
    ca.year_from,
    ca.year_to,
    nullif(btrim(ca.notes), '')
  from public.product_enrichment_candidate_applications ca
  where ca.candidate_id = v.id
    and ca.tenant_id = v.tenant_id
    and ca.selected
    and not exists (
      select 1 from public.product_applications pa
      where pa.tenant_id = v.tenant_id
        and pa.product_id = v.product_id
        and lower(btrim(pa.vehicle_make)) = lower(btrim(ca.vehicle_make))
        and lower(btrim(pa.vehicle_model)) = lower(btrim(ca.vehicle_model))
        and coalesce(pa.year_from, 0) = coalesce(ca.year_from, 0)
        and coalesce(pa.year_to, 9999) = coalesce(ca.year_to, 9999)
    );
  get diagnostics v_apps_added = row_count;

  update public.product_enrichment_candidates
  set status = 'approved', reviewed_by = v_user, reviewed_at = now()
  where id = v.id;

  update public.product_enrichment_candidates
  set status = 'rejected', reviewed_by = v_user, reviewed_at = now()
  where job_id = v.job_id
    and tenant_id = v.tenant_id
    and id <> v.id
    and status = 'pending';

  update public.product_enrichment_jobs
  set status = 'approved', approved_by = v_user, finished_at = now(), last_error = null
  where id = v.job_id and tenant_id = v.tenant_id;

  return jsonb_build_object(
    'ok', true,
    'product_id', v.product_id,
    'candidate_id', v.id,
    'images_added', v_images_added,
    'applications_added', v_apps_added
  );
end;
$$;

revoke all on function public.approve_product_enrichment_candidate(uuid) from public, anon;
grant execute on function public.approve_product_enrichment_candidate(uuid) to authenticated, service_role;

commit;
