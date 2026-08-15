-- Catálogo inteligente de fabricantes: fontes oficiais e regras auditáveis por marca.
begin;

create table if not exists public.manufacturer_catalog_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  brand_id uuid not null,
  name text not null,
  source_kind text not null default 'official_site'
    check (source_kind in ('official_site','official_catalog','catalog_api','supplier_feed','manual')),
  base_url text not null check (base_url ~ '^https://'),
  search_url_template text,
  allowed_domains text[] not null default '{}'::text[],
  supported_fields text[] not null default array['name','description','specifications']::text[],
  image_usage_note text,
  priority smallint not null default 50 check (priority between 1 and 100),
  status text not null default 'active' check (status in ('active','paused','error')),
  last_verified_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manufacturer_catalog_sources_brand_tenant_fkey
    foreign key (brand_id,tenant_id) references public.brands(id,tenant_id) on delete cascade,
  constraint manufacturer_catalog_sources_tenant_name_key unique (tenant_id,brand_id,name)
);

create table if not exists public.manufacturer_code_patterns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  brand_id uuid not null,
  name text not null,
  code_regex text not null,
  normalized_prefix text,
  examples text[] not null default '{}'::text[],
  priority smallint not null default 50 check (priority between 1 and 100),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manufacturer_code_patterns_brand_tenant_fkey
    foreign key (brand_id,tenant_id) references public.brands(id,tenant_id) on delete cascade,
  constraint manufacturer_code_patterns_tenant_name_key unique (tenant_id,brand_id,name)
);

create index if not exists manufacturer_catalog_sources_lookup
  on public.manufacturer_catalog_sources(tenant_id,brand_id,status,priority desc);
create index if not exists manufacturer_code_patterns_lookup
  on public.manufacturer_code_patterns(tenant_id,brand_id,active,priority desc);

drop trigger if exists manufacturer_catalog_sources_updated_at on public.manufacturer_catalog_sources;
create trigger manufacturer_catalog_sources_updated_at before update on public.manufacturer_catalog_sources
for each row execute function private.set_updated_at();
drop trigger if exists manufacturer_code_patterns_updated_at on public.manufacturer_code_patterns;
create trigger manufacturer_code_patterns_updated_at before update on public.manufacturer_code_patterns
for each row execute function private.set_updated_at();

alter table public.manufacturer_catalog_sources enable row level security;
alter table public.manufacturer_code_patterns enable row level security;

create policy manufacturer_catalog_sources_select on public.manufacturer_catalog_sources
for select to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager','stock']::text[])));
create policy manufacturer_catalog_sources_insert on public.manufacturer_catalog_sources
for insert to authenticated
with check ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy manufacturer_catalog_sources_update on public.manufacturer_catalog_sources
for update to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])))
with check ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy manufacturer_catalog_sources_delete on public.manufacturer_catalog_sources
for delete to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy manufacturer_code_patterns_select on public.manufacturer_code_patterns
for select to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager','stock']::text[])));
create policy manufacturer_code_patterns_insert on public.manufacturer_code_patterns
for insert to authenticated
with check ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy manufacturer_code_patterns_update on public.manufacturer_code_patterns
for update to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])))
with check ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy manufacturer_code_patterns_delete on public.manufacturer_code_patterns
for delete to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));

grant select,insert,update,delete on public.manufacturer_catalog_sources,public.manufacturer_code_patterns to authenticated;
grant all on public.manufacturer_catalog_sources,public.manufacturer_code_patterns to service_role;
revoke all on public.manufacturer_catalog_sources,public.manufacturer_code_patterns from anon;

-- A marca Shocklight já foi confirmada no catálogo atual. O registro é idempotente.
insert into public.manufacturer_catalog_sources (
  tenant_id,brand_id,name,source_kind,base_url,allowed_domains,supported_fields,
  image_usage_note,priority,status,last_verified_at
)
select b.tenant_id,b.id,'Site oficial Shocklight','official_site','https://www.shocklight.com.br',
  array['shocklight.com.br','www.shocklight.com.br'],
  array['name','description','specifications','manufacturer_code'],
  'Confirmar autorização ou licença antes de reutilizar imagens.',100,'active',now()
from public.brands b where lower(b.name)='shocklight'
on conflict (tenant_id,brand_id,name) do update set
  base_url=excluded.base_url,allowed_domains=excluded.allowed_domains,
  supported_fields=excluded.supported_fields,priority=excluded.priority,status='active',last_verified_at=now();

insert into public.manufacturer_code_patterns (
  tenant_id,brand_id,name,code_regex,normalized_prefix,examples,priority,active
)
select b.tenant_id,b.id,'Código Shocklight com prefixo SL','^SL-[A-Z0-9-]+$','SL-',
  array['SL-120004','SL-120011','SL-040910U'],100,true
from public.brands b where lower(b.name)='shocklight'
on conflict (tenant_id,brand_id,name) do update set
  code_regex=excluded.code_regex,normalized_prefix=excluded.normalized_prefix,
  examples=excluded.examples,priority=excluded.priority,active=true;

commit;
