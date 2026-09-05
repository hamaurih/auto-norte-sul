-- Central de Aplicação Veicular
-- Candidato -> evidência -> revisão -> aplicação publicada.
-- Sugestões do nome do produto nunca são autoaprovadas.

create table if not exists public.vehicle_reference_models (
  id uuid primary key default gen_random_uuid(),
  vehicle_make text not null,
  vehicle_model text not null,
  make_aliases text[] not null default '{}'::text[],
  model_aliases text[] not null default '{}'::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (vehicle_make, vehicle_model)
);
grant select on public.vehicle_reference_models to authenticated, service_role;
revoke all on public.vehicle_reference_models from anon;

insert into public.vehicle_reference_models(vehicle_make,vehicle_model,make_aliases,model_aliases) values
('Chevrolet','Onix',array['CHEVROLET','GM'],array['ONIX']),('Chevrolet','Prisma',array['CHEVROLET','GM'],array['PRISMA']),('Chevrolet','Celta',array['CHEVROLET','GM'],array['CELTA']),('Chevrolet','Corsa',array['CHEVROLET','GM'],array['CORSA']),('Chevrolet','Classic',array['CHEVROLET','GM'],array['CLASSIC']),('Chevrolet','Montana',array['CHEVROLET','GM'],array['MONTANA']),('Chevrolet','S10',array['CHEVROLET','GM'],array['S10']),('Chevrolet','Trailblazer',array['CHEVROLET','GM'],array['TRAILBLAZER']),('Chevrolet','Spin',array['CHEVROLET','GM'],array['SPIN']),('Chevrolet','Cobalt',array['CHEVROLET','GM'],array['COBALT']),('Chevrolet','Astra',array['CHEVROLET','GM'],array['ASTRA']),('Chevrolet','Vectra',array['CHEVROLET','GM'],array['VECTRA']),('Chevrolet','Meriva',array['CHEVROLET','GM'],array['MERIVA']),('Chevrolet','Kadett',array['CHEVROLET','GM'],array['KADETT']),
('Volkswagen','Gol',array['VOLKSWAGEN','VW'],array['GOL']),('Volkswagen','Voyage',array['VOLKSWAGEN','VW'],array['VOYAGE']),('Volkswagen','Saveiro',array['VOLKSWAGEN','VW'],array['SAVEIRO']),('Volkswagen','Fox',array['VOLKSWAGEN','VW'],array['FOX']),('Volkswagen','Polo',array['VOLKSWAGEN','VW'],array['POLO']),('Volkswagen','Virtus',array['VOLKSWAGEN','VW'],array['VIRTUS']),('Volkswagen','Golf',array['VOLKSWAGEN','VW'],array['GOLF']),('Volkswagen','Jetta',array['VOLKSWAGEN','VW'],array['JETTA']),('Volkswagen','Amarok',array['VOLKSWAGEN','VW'],array['AMAROK']),('Volkswagen','Parati',array['VOLKSWAGEN','VW'],array['PARATI']),('Volkswagen','Santana',array['VOLKSWAGEN','VW'],array['SANTANA']),('Volkswagen','Kombi',array['VOLKSWAGEN','VW'],array['KOMBI']),('Volkswagen','Up',array['VOLKSWAGEN','VW'],array['UP']),('Volkswagen','T-Cross',array['VOLKSWAGEN','VW'],array['T CROSS','TCROSS']),('Volkswagen','Nivus',array['VOLKSWAGEN','VW'],array['NIVUS']),
('Fiat','Uno',array['FIAT'],array['UNO']),('Fiat','Palio',array['FIAT'],array['PALIO']),('Fiat','Siena',array['FIAT'],array['SIENA','GRAND SIENA']),('Fiat','Strada',array['FIAT'],array['STRADA']),('Fiat','Toro',array['FIAT'],array['TORO']),('Fiat','Argo',array['FIAT'],array['ARGO']),('Fiat','Cronos',array['FIAT'],array['CRONOS']),('Fiat','Mobi',array['FIAT'],array['MOBI']),('Fiat','Doblo',array['FIAT'],array['DOBLO']),('Fiat','Fiorino',array['FIAT'],array['FIORINO']),('Fiat','Linea',array['FIAT'],array['LINEA']),('Fiat','Idea',array['FIAT'],array['IDEA']),('Fiat','Punto',array['FIAT'],array['PUNTO']),
('Ford','Ka',array['FORD'],array['KA']),('Ford','Fiesta',array['FORD'],array['FIESTA']),('Ford','EcoSport',array['FORD'],array['ECOSPORT','ECO SPORT']),('Ford','Ranger',array['FORD'],array['RANGER']),('Ford','Focus',array['FORD'],array['FOCUS']),('Ford','Courier',array['FORD'],array['COURIER']),
('Toyota','Corolla',array['TOYOTA'],array['COROLLA']),('Toyota','Hilux',array['TOYOTA'],array['HILUX']),('Toyota','SW4',array['TOYOTA'],array['SW4']),('Toyota','Etios',array['TOYOTA'],array['ETIOS']),('Toyota','Yaris',array['TOYOTA'],array['YARIS']),('Toyota','RAV4',array['TOYOTA'],array['RAV4','RAV 4']),
('Hyundai','HB20',array['HYUNDAI'],array['HB20','HB20S']),('Hyundai','Creta',array['HYUNDAI'],array['CRETA']),('Hyundai','Tucson',array['HYUNDAI'],array['TUCSON']),('Hyundai','i30',array['HYUNDAI'],array['I30']),
('Honda','Civic',array['HONDA'],array['CIVIC']),('Honda','City',array['HONDA'],array['CITY']),('Honda','Fit',array['HONDA'],array['FIT','NEW FIT']),('Honda','HR-V',array['HONDA'],array['HRV','HR V']),('Honda','CR-V',array['HONDA'],array['CRV','CR V']),
('Renault','Clio',array['RENAULT'],array['CLIO']),('Renault','Sandero',array['RENAULT'],array['SANDERO']),('Renault','Logan',array['RENAULT'],array['LOGAN']),('Renault','Duster',array['RENAULT'],array['DUSTER']),('Renault','Kwid',array['RENAULT'],array['KWID']),('Renault','Master',array['RENAULT'],array['MASTER']),
('Nissan','Kicks',array['NISSAN'],array['KICKS']),('Nissan','Frontier',array['NISSAN'],array['FRONTIER']),('Nissan','March',array['NISSAN'],array['MARCH']),('Nissan','Versa',array['NISSAN'],array['VERSA']),
('Peugeot','206',array['PEUGEOT'],array['206']),('Peugeot','207',array['PEUGEOT'],array['207']),('Peugeot','208',array['PEUGEOT'],array['208']),('Peugeot','307',array['PEUGEOT'],array['307']),('Peugeot','Partner',array['PEUGEOT'],array['PARTNER']),('Peugeot','Boxer',array['PEUGEOT'],array['BOXER']),
('Citroen','C3',array['CITROEN','CITROËN'],array['C3']),('Citroen','C4',array['CITROEN','CITROËN'],array['C4']),('Citroen','Picasso',array['CITROEN','CITROËN'],array['PICASSO']),('Citroen','Jumper',array['CITROEN','CITROËN'],array['JUMPER']),
('Jeep','Renegade',array['JEEP'],array['RENEGADE']),('Jeep','Compass',array['JEEP'],array['COMPASS']),('Jeep','Commander',array['JEEP'],array['COMMANDER']),
('BYD','Dolphin',array['BYD'],array['DOLPHIN']),('BYD','Dolphin Mini',array['BYD'],array['DOLPHIN MINI']),
('Chery','Tiggo 2',array['CHERY'],array['TIGGO 2']),('Chery','Tiggo 5X',array['CHERY'],array['TIGGO 5X']),('Chery','Tiggo 7',array['CHERY'],array['TIGGO 7','TIGGO7']),('Chery','Tiggo 8',array['CHERY'],array['TIGGO 8','TIGGO8']),
('Mitsubishi','L200',array['MITSUBISHI'],array['L200']),('Mitsubishi','Pajero',array['MITSUBISHI'],array['PAJERO']),('Mitsubishi','ASX',array['MITSUBISHI'],array['ASX']),('Kia','Bongo',array['KIA'],array['BONGO']),('Kia','Sportage',array['KIA'],array['SPORTAGE'])
on conflict (vehicle_make,vehicle_model) do update set make_aliases=excluded.make_aliases,model_aliases=excluded.model_aliases,active=true;

create table if not exists public.vehicle_application_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  vehicle_make text not null,
  vehicle_model text not null,
  year_from integer,
  year_to integer,
  source_type text not null check (source_type in ('official_enrichment','product_name','manual','import')),
  source_record_id uuid,
  source_name text,
  source_url text,
  evidence_text text,
  match_reason text,
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_application_candidate_years check ((year_from is null or year_from between 1950 and 2035) and (year_to is null or year_to between 1950 and 2035) and (year_from is null or year_to is null or year_from <= year_to)),
  unique (source_type,source_record_id)
);
create unique index if not exists uq_vehicle_application_candidates_content on public.vehicle_application_candidates(tenant_id,product_id,lower(vehicle_make),lower(vehicle_model),coalesce(year_from,-1),coalesce(year_to,-1),source_type);
create unique index if not exists uq_vehicle_application_candidates_product_name_model on public.vehicle_application_candidates(tenant_id,product_id,lower(vehicle_make),lower(vehicle_model),source_type) where source_type='product_name';
create index if not exists idx_vehicle_application_candidates_queue on public.vehicle_application_candidates(tenant_id,status,confidence desc,created_at desc);
create index if not exists idx_vehicle_application_candidates_product on public.vehicle_application_candidates(tenant_id,product_id);
alter table public.vehicle_application_candidates enable row level security;
drop policy if exists vehicle_application_candidates_read on public.vehicle_application_candidates;
create policy vehicle_application_candidates_read on public.vehicle_application_candidates for select to authenticated using (private.has_tenant_role(tenant_id) or private.has_tenant_module_permission(tenant_id,'catalog','view'));
revoke all on public.vehicle_application_candidates from anon,authenticated;
grant select on public.vehicle_application_candidates to authenticated;
grant all on public.vehicle_application_candidates to service_role;

create table if not exists public.vehicle_application_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  candidate_id uuid references public.vehicle_application_candidates(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  action text not null check (action in ('candidate_created','approved','rejected','published','edited')),
  actor_user_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_vehicle_application_audit_tenant on public.vehicle_application_audit(tenant_id,created_at desc);
alter table public.vehicle_application_audit enable row level security;
drop policy if exists vehicle_application_audit_read on public.vehicle_application_audit;
create policy vehicle_application_audit_read on public.vehicle_application_audit for select to authenticated using (private.has_tenant_role(tenant_id) or private.has_tenant_module_permission(tenant_id,'catalog','view'));
revoke all on public.vehicle_application_audit from anon,authenticated;
grant select on public.vehicle_application_audit to authenticated;
grant all on public.vehicle_application_audit to service_role;

alter table public.product_applications add column if not exists source_type text not null default 'manual',add column if not exists source_name text,add column if not exists source_url text,add column if not exists confidence numeric(5,4),add column if not exists candidate_id uuid references public.vehicle_application_candidates(id) on delete set null,add column if not exists verified_at timestamptz,add column if not exists verified_by uuid;
create unique index if not exists uq_product_applications_normalized on public.product_applications(tenant_id,product_id,lower(btrim(vehicle_make)),lower(btrim(vehicle_model)),coalesce(year_from,-1),coalesce(year_to,-1));
create unique index if not exists uq_product_applications_candidate on public.product_applications(candidate_id) where candidate_id is not null;

create or replace function private.vehicle_match_text(p_text text) returns text language sql immutable set search_path='' as $$ select ' '||btrim(regexp_replace(upper(coalesce(p_text,'')),'[^A-Z0-9]+',' ','g'))||' ' $$;
revoke all on function private.vehicle_match_text(text) from public,anon,authenticated;
grant execute on function private.vehicle_match_text(text) to service_role;

create or replace function public.generate_vehicle_application_candidates_from_names(p_tenant_id uuid,p_limit integer default 1000) returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer:=0;
begin
  if not (private.has_tenant_role(p_tenant_id,array['owner','admin','manager','stock']) or private.has_tenant_module_permission(p_tenant_id,'catalog','update')) then raise exception 'Forbidden' using errcode='42501'; end if;
  with targets as (
    select p.id,p.name,private.vehicle_match_text(p.name) norm from public.products p where p.tenant_id=p_tenant_id and p.active and p.deleted_at is null and not exists(select 1 from public.product_applications pa where pa.tenant_id=p.tenant_id and pa.product_id=p.id) order by p.updated_at desc,p.id limit greatest(1,least(coalesce(p_limit,1000),5000))
  ), raw_matches as (
    select distinct t.id product_id,t.name evidence_text,r.id ref_id,r.vehicle_make,r.vehicle_model,exists(select 1 from unnest(r.make_aliases) ma where t.norm like '% '||btrim(private.vehicle_match_text(ma))||' %') make_explicit,min(length(alias_text)) over(partition by t.id,r.id) alias_len
    from targets t join public.vehicle_reference_models r on r.active cross join lateral unnest(r.model_aliases) alias_text where t.norm like '% '||btrim(private.vehicle_match_text(alias_text))||' %'
  ), counted as (select rm.*,count(*) over(partition by rm.product_id) model_count from raw_matches rm), with_years as (
    select c.*,case when c.model_count=1 and y.m is not null then (y.m)[1]::integer end year_from,case when c.model_count=1 and y.m is not null then (y.m)[3]::integer end year_to
    from counted c left join lateral (select regexp_match(upper(c.evidence_text),'(19[5-9][0-9]|20[0-3][0-9])[[:space:]]*(/|-| A | ATE | ATÉ )[[:space:]]*(19[5-9][0-9]|20[0-3][0-9])','i') m) y on true
  ), limited as (select * from with_years order by product_id,vehicle_make,vehicle_model limit greatest(1,least(coalesce(p_limit,1000),5000)))
  insert into public.vehicle_application_candidates(tenant_id,product_id,vehicle_make,vehicle_model,year_from,year_to,source_type,source_name,evidence_text,match_reason,confidence,status,created_by)
  select p_tenant_id,l.product_id,l.vehicle_make,l.vehicle_model,l.year_from,l.year_to,'product_name','Nome do cadastro',l.evidence_text,
    case when l.model_count=1 and l.make_explicit and l.year_from is not null then 'Marca, modelo e período explícitos no nome do produto' when l.model_count=1 and l.year_from is not null then 'Modelo e período explícitos no nome do produto' when l.make_explicit then 'Marca e modelo explícitos no nome do produto' else 'Modelo explícito no nome do produto; requer validação humana' end,
    case when l.alias_len<=2 then 0.55 when l.model_count=1 and l.make_explicit and l.year_from is not null then 0.90 when l.model_count=1 and l.year_from is not null then 0.82 when l.make_explicit then 0.76 else 0.68 end,'pending',auth.uid() from limited l on conflict do nothing;
  get diagnostics v_count=row_count; return v_count;
end; $$;
revoke all on function public.generate_vehicle_application_candidates_from_names(uuid,integer) from public,anon;
grant execute on function public.generate_vehicle_application_candidates_from_names(uuid,integer) to authenticated,service_role;

create or replace function public.review_vehicle_application_candidate(p_candidate_id uuid,p_decision text,p_vehicle_make text default null,p_vehicle_model text default null,p_year_from integer default null,p_year_to integer default null,p_review_notes text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.vehicle_application_candidates%rowtype;v_make text;v_model text;v_from integer;v_to integer;v_app_id uuid;v_before jsonb;
begin
  select * into v from public.vehicle_application_candidates where id=p_candidate_id for update; if not found then raise exception 'Candidato não encontrado'; end if;
  if not (private.has_tenant_role(v.tenant_id,array['owner','admin','manager','stock']) or private.has_tenant_module_permission(v.tenant_id,'catalog','update')) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Decisão inválida'; end if; if v.status<>'pending' then return jsonb_build_object('ok',true,'status',v.status,'idempotent',true); end if;
  v_before:=to_jsonb(v);v_make:=nullif(btrim(coalesce(p_vehicle_make,v.vehicle_make)),'');v_model:=nullif(btrim(coalesce(p_vehicle_model,v.vehicle_model)),'');v_from:=coalesce(p_year_from,v.year_from);v_to:=coalesce(p_year_to,v.year_to);
  if p_decision='reject' then update public.vehicle_application_candidates set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_notes=p_review_notes,updated_at=now() where id=v.id;insert into public.vehicle_application_audit(tenant_id,candidate_id,product_id,action,actor_user_id,before_data,after_data) values(v.tenant_id,v.id,v.product_id,'rejected',auth.uid(),v_before,jsonb_build_object('review_notes',p_review_notes));return jsonb_build_object('ok',true,'status','rejected');end if;
  if v_make is null or v_model is null then raise exception 'Marca e modelo são obrigatórios'; end if;if v_from is not null and (v_from<1950 or v_from>2035) then raise exception 'Ano inicial inválido';end if;if v_to is not null and (v_to<1950 or v_to>2035) then raise exception 'Ano final inválido';end if;if v_from is not null and v_to is not null and v_from>v_to then raise exception 'Faixa de anos inválida';end if;
  select pa.id into v_app_id from public.product_applications pa where pa.tenant_id=v.tenant_id and pa.product_id=v.product_id and lower(btrim(pa.vehicle_make))=lower(v_make) and lower(btrim(pa.vehicle_model))=lower(v_model) and coalesce(pa.year_from,-1)=coalesce(v_from,-1) and coalesce(pa.year_to,-1)=coalesce(v_to,-1) limit 1;
  if v_app_id is null then insert into public.product_applications(tenant_id,product_id,vehicle_make,vehicle_model,year_from,year_to,notes,source_type,source_name,source_url,confidence,candidate_id,verified_at,verified_by) values(v.tenant_id,v.product_id,v_make,v_model,v_from,v_to,p_review_notes,v.source_type,v.source_name,v.source_url,v.confidence,v.id,now(),auth.uid()) returning id into v_app_id;end if;
  update public.vehicle_application_candidates set vehicle_make=v_make,vehicle_model=v_model,year_from=v_from,year_to=v_to,status='approved',reviewed_by=auth.uid(),reviewed_at=now(),review_notes=p_review_notes,updated_at=now() where id=v.id;
  insert into public.vehicle_application_audit(tenant_id,candidate_id,product_id,action,actor_user_id,before_data,after_data) values(v.tenant_id,v.id,v.product_id,'approved',auth.uid(),v_before,jsonb_build_object('application_id',v_app_id,'vehicle_make',v_make,'vehicle_model',v_model,'year_from',v_from,'year_to',v_to));
  return jsonb_build_object('ok',true,'status','approved','application_id',v_app_id);
end; $$;
revoke all on function public.review_vehicle_application_candidate(uuid,text,text,text,integer,integer,text) from public,anon;
grant execute on function public.review_vehicle_application_candidate(uuid,text,text,text,integer,integer,text) to authenticated,service_role;

create or replace function private.mirror_enrichment_vehicle_application() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.product_enrichment_candidates%rowtype;
begin select * into c from public.product_enrichment_candidates where id=new.candidate_id;insert into public.vehicle_application_candidates(tenant_id,product_id,vehicle_make,vehicle_model,year_from,year_to,source_type,source_record_id,source_name,source_url,evidence_text,match_reason,confidence,status) values(new.tenant_id,new.product_id,btrim(new.vehicle_make),btrim(new.vehicle_model),new.year_from,new.year_to,'official_enrichment',new.id,c.source_name,c.source_url,coalesce(new.source_text,new.notes),'Aplicação encontrada pelo enriquecimento em fonte cadastrada do fabricante',greatest(0,least(1,coalesce(new.confidence,c.confidence,0))),'pending') on conflict do nothing;return new;end; $$;
revoke all on function private.mirror_enrichment_vehicle_application() from public,anon,authenticated;
drop trigger if exists trg_mirror_enrichment_vehicle_application on public.product_enrichment_candidate_applications;
create trigger trg_mirror_enrichment_vehicle_application after insert or update of vehicle_make,vehicle_model,year_from,year_to,confidence,source_text on public.product_enrichment_candidate_applications for each row execute function private.mirror_enrichment_vehicle_application();

create or replace function public.get_vehicle_application_center_stats(p_tenant_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_total bigint;v_with_app bigint;v_apps bigint;v_pending bigint;v_high bigint;v_official bigint;v_approved bigint;v_rejected bigint;
begin
  if not (private.has_tenant_role(p_tenant_id) or private.has_tenant_module_permission(p_tenant_id,'catalog','view')) then raise exception 'Forbidden' using errcode='42501';end if;
  select count(*) into v_total from public.products p where p.tenant_id=p_tenant_id and p.active and p.deleted_at is null;
  select count(distinct pa.product_id),count(*) into v_with_app,v_apps from public.product_applications pa where pa.tenant_id=p_tenant_id;
  select count(*) filter(where c.status='pending'),count(*) filter(where c.status='pending' and c.confidence>=0.90),count(*) filter(where c.status='pending' and c.source_type='official_enrichment'),count(*) filter(where c.status='approved'),count(*) filter(where c.status='rejected') into v_pending,v_high,v_official,v_approved,v_rejected from public.vehicle_application_candidates c where c.tenant_id=p_tenant_id;
  return jsonb_build_object('active_products',v_total,'products_with_applications',coalesce(v_with_app,0),'products_without_applications',greatest(v_total-coalesce(v_with_app,0),0),'published_applications',coalesce(v_apps,0),'pending_candidates',coalesce(v_pending,0),'high_confidence_pending',coalesce(v_high,0),'official_source_pending',coalesce(v_official,0),'approved_candidates',coalesce(v_approved,0),'rejected_candidates',coalesce(v_rejected,0));
end; $$;
revoke all on function public.get_vehicle_application_center_stats(uuid) from public,anon;
grant execute on function public.get_vehicle_application_center_stats(uuid) to authenticated,service_role;
