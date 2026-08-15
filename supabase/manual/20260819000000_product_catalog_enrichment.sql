-- Enriquecimento autônomo e auditável do catálogo
begin;
create table if not exists public.product_enrichment_jobs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 product_id uuid not null, trigger_source text not null default 'manual' check (trigger_source in ('manual','product_created','nfe','integration','bulk')),
 status text not null default 'queued' check (status in ('queued','processing','review','approved','failed','cancelled')),
 search_query text, attempts integer not null default 0 check (attempts>=0), last_error text,
 scheduled_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 created_by uuid references auth.users(id) on delete set null, approved_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint product_enrichment_jobs_id_tenant_key unique(id,tenant_id),
 constraint product_enrichment_jobs_product_tenant_fkey foreign key(product_id,tenant_id) references public.products(id,tenant_id) on delete cascade
);
create unique index if not exists product_enrichment_jobs_one_active on public.product_enrichment_jobs(tenant_id,product_id) where status in ('queued','processing','review');
create index if not exists product_enrichment_jobs_queue on public.product_enrichment_jobs(tenant_id,status,scheduled_at);

create table if not exists public.product_enrichment_candidates (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 job_id uuid not null, product_id uuid not null,
 source_type text not null check (source_type in ('bling','gs1','manufacturer','supplier','authorized_distributor','web','manual')),
 source_name text, source_url text not null, license_name text, license_url text, image_url text, storage_url text,
 suggested_name text, suggested_short_description text, suggested_description text, suggested_gtin text, suggested_manufacturer_code text,
 specifications jsonb not null default '{}'::jsonb, confidence numeric(5,2) not null default 0 check(confidence between 0 and 100),
 match_reasons jsonb not null default '[]'::jsonb, status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_by uuid references auth.users(id) on delete set null, reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint product_enrichment_candidates_job_tenant_fkey foreign key(job_id,tenant_id) references public.product_enrichment_jobs(id,tenant_id) on delete cascade,
 constraint product_enrichment_candidates_product_tenant_fkey foreign key(product_id,tenant_id) references public.products(id,tenant_id) on delete cascade
);
create index if not exists product_enrichment_candidates_review on public.product_enrichment_candidates(tenant_id,status,confidence desc);
drop trigger if exists product_enrichment_jobs_updated_at on public.product_enrichment_jobs;
create trigger product_enrichment_jobs_updated_at before update on public.product_enrichment_jobs for each row execute function private.set_updated_at();
drop trigger if exists product_enrichment_candidates_updated_at on public.product_enrichment_candidates;
create trigger product_enrichment_candidates_updated_at before update on public.product_enrichment_candidates for each row execute function private.set_updated_at();
alter table public.product_enrichment_jobs enable row level security;
alter table public.product_enrichment_candidates enable row level security;
create policy product_enrichment_jobs_select on public.product_enrichment_jobs for select to authenticated using((select private.has_tenant_role(tenant_id,array['owner','admin','manager','stock']::text[])));
create policy product_enrichment_jobs_write on public.product_enrichment_jobs for all to authenticated using((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[]))) with check((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy product_enrichment_candidates_select on public.product_enrichment_candidates for select to authenticated using((select private.has_tenant_role(tenant_id,array['owner','admin','manager','stock']::text[])));
create policy product_enrichment_candidates_write on public.product_enrichment_candidates for all to authenticated using((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[]))) with check((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
grant select,insert,update,delete on public.product_enrichment_jobs,public.product_enrichment_candidates to authenticated;
grant all on public.product_enrichment_jobs,public.product_enrichment_candidates to service_role;
revoke all on public.product_enrichment_jobs,public.product_enrichment_candidates from anon;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.enqueue_products_for_enrichment(p_tenant_id uuid,p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 if auth.uid() is null or not exists(select 1 from public.tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=auth.uid() and m.active and m.role in ('owner','admin','manager'))
 then raise exception 'Sem permissão para enriquecer produtos'; end if;
 with missing as (
  select p.id,concat_ws(' ',p.gtin,p.manufacturer_code,p.sku,p.name) query from public.products p
  where p.tenant_id=p_tenant_id and p.active and
   (nullif(btrim(coalesce(p.description,'')),'') is null or not exists(select 1 from public.product_images i where i.tenant_id=p.tenant_id and i.product_id=p.id))
   and not exists(select 1 from public.product_enrichment_jobs j where j.tenant_id=p.tenant_id and j.product_id=p.id and j.status in ('queued','processing','review'))
  order by p.updated_at desc limit greatest(1,least(coalesce(p_limit,100),500))
 )
 insert into public.product_enrichment_jobs(tenant_id,product_id,trigger_source,search_query,created_by)
 select p_tenant_id,id,'bulk',query,auth.uid() from missing;
 get diagnostics v_count=row_count; return v_count;
end; $$;

create or replace function public.approve_product_enrichment_candidate(p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.product_enrichment_candidates%rowtype; v_user uuid:=auth.uid();
begin
 select * into v from public.product_enrichment_candidates where id=p_candidate_id for update;
 if not found then raise exception 'Sugestão não encontrada'; end if;
 if v_user is null or not exists(select 1 from public.tenant_memberships m where m.tenant_id=v.tenant_id and m.user_id=v_user and m.active and m.role in ('owner','admin','manager'))
 then raise exception 'Sem permissão para aprovar'; end if;
 if v.status<>'pending' then raise exception 'Sugestão já revisada'; end if;
 if v.image_url is not null and v.storage_url is null then raise exception 'Copie a imagem para o armazenamento próprio antes de aprovar'; end if;
 update public.products p set
  name=coalesce(nullif(btrim(v.suggested_name),''),p.name),
  short_description=coalesce(nullif(btrim(v.suggested_short_description),''),p.short_description),
  description=coalesce(nullif(btrim(v.suggested_description),''),p.description),
  gtin=coalesce(nullif(regexp_replace(v.suggested_gtin,'\D','','g'),''),p.gtin),
  manufacturer_code=coalesce(nullif(btrim(v.suggested_manufacturer_code),''),p.manufacturer_code),updated_at=now()
 where p.id=v.product_id and p.tenant_id=v.tenant_id;
 if v.storage_url is not null and not exists(select 1 from public.product_images i where i.tenant_id=v.tenant_id and i.product_id=v.product_id and i.url=v.storage_url) then
  insert into public.product_images(tenant_id,product_id,url,alt,sort_order,is_primary)
  values(v.tenant_id,v.product_id,v.storage_url,coalesce(v.suggested_name,(select name from public.products where id=v.product_id)),0,
   not exists(select 1 from public.product_images i where i.tenant_id=v.tenant_id and i.product_id=v.product_id));
 end if;
 update public.product_enrichment_candidates set status='approved',reviewed_by=v_user,reviewed_at=now() where id=v.id;
 update public.product_enrichment_candidates set status='rejected',reviewed_by=v_user,reviewed_at=now() where job_id=v.job_id and tenant_id=v.tenant_id and id<>v.id and status='pending';
 update public.product_enrichment_jobs set status='approved',approved_by=v_user,finished_at=now(),last_error=null where id=v.job_id and tenant_id=v.tenant_id;
 return jsonb_build_object('ok',true,'product_id',v.product_id,'candidate_id',v.id);
end; $$;
revoke all on function public.enqueue_products_for_enrichment(uuid,integer) from public,anon;
revoke all on function public.approve_product_enrichment_candidate(uuid) from public,anon;
grant execute on function public.enqueue_products_for_enrichment(uuid,integer) to authenticated,service_role;
grant execute on function public.approve_product_enrichment_candidate(uuid) to authenticated,service_role;
commit;