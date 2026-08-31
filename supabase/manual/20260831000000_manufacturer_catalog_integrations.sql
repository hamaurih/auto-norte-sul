-- Integração de catálogos oficiais: FKS, KX3, Brucke e Reforcel.
-- Idempotente e multi-tenant: cria marcas apenas onde já existem produtos que as identificam no nome.
begin;

insert into public.brands (tenant_id, name, slug, featured)
select distinct p.tenant_id, 'FKS', 'fks', false
from public.products p
where p.name ~* '(^|[^[:alnum:]])FKS([^[:alnum:]]|$)'
on conflict (tenant_id, slug) do update set name = excluded.name;

insert into public.brands (tenant_id, name, slug, featured)
select distinct p.tenant_id, 'KX3', 'kx3', false
from public.products p
where p.name ~* '(^|[^[:alnum:]])KX3([^[:alnum:]]|$)'
on conflict (tenant_id, slug) do update set name = excluded.name;

insert into public.brands (tenant_id, name, slug, featured)
select distinct p.tenant_id, 'Brucke', 'brucke', false
from public.products p
where p.name ~* '(^|[^[:alnum:]])BRUCKE([^[:alnum:]]|$)'
on conflict (tenant_id, slug) do update set name = excluded.name;

insert into public.brands (tenant_id, name, slug, featured)
select distinct p.tenant_id, 'Reforcel', 'reforcel', false
from public.products p
where p.name ~* '(^|[^[:alnum:]])REFORCEL([^[:alnum:]]|$)'
on conflict (tenant_id, slug) do update set name = excluded.name;

-- Vinculação determinística: somente produtos ainda sem marca e cujo próprio nome declara a marca.
-- Reforcel vem antes de Brucke porque alguns materiais comerciais podem mencionar as duas linhas.
update public.products p
set brand_id = b.id, updated_at = now()
from public.brands b
where p.brand_id is null
  and p.tenant_id = b.tenant_id
  and b.slug = 'reforcel'
  and p.name ~* '(^|[^[:alnum:]])REFORCEL([^[:alnum:]]|$)';

update public.products p
set brand_id = b.id, updated_at = now()
from public.brands b
where p.brand_id is null
  and p.tenant_id = b.tenant_id
  and b.slug = 'kx3'
  and p.name ~* '(^|[^[:alnum:]])KX3([^[:alnum:]]|$)';

update public.products p
set brand_id = b.id, updated_at = now()
from public.brands b
where p.brand_id is null
  and p.tenant_id = b.tenant_id
  and b.slug = 'fks'
  and p.name ~* '(^|[^[:alnum:]])FKS([^[:alnum:]]|$)';

update public.products p
set brand_id = b.id, updated_at = now()
from public.brands b
where p.brand_id is null
  and p.tenant_id = b.tenant_id
  and b.slug = 'brucke'
  and p.name ~* '(^|[^[:alnum:]])BRUCKE([^[:alnum:]]|$)';

-- Fontes oficiais. search_url_template aponta para o índice que contém os produtos,
-- permitindo localizar o código e seguir somente links do domínio permitido.
insert into public.manufacturer_catalog_sources (
  tenant_id, brand_id, name, source_kind, base_url, search_url_template,
  allowed_domains, supported_fields, image_usage_note, priority, status, last_verified_at
)
select b.tenant_id, b.id, 'Catálogo oficial FKS', 'official_catalog',
  'https://www.fks.com.br', 'https://www.fks.com.br/produtos/automotiva/',
  array['fks.com.br','www.fks.com.br'],
  array['name','description','specifications','manufacturer_code','image','vehicle_application','manual'],
  'Material obtido da fonte oficial. Confirmar autorização comercial/licença antes da publicação de imagens.',
  100, 'active', now()
from public.brands b where b.slug = 'fks'
on conflict (tenant_id, brand_id, name) do update set
  source_kind = excluded.source_kind,
  base_url = excluded.base_url,
  search_url_template = excluded.search_url_template,
  allowed_domains = excluded.allowed_domains,
  supported_fields = excluded.supported_fields,
  image_usage_note = excluded.image_usage_note,
  priority = excluded.priority,
  status = 'active',
  last_verified_at = now(),
  last_error = null;

insert into public.manufacturer_catalog_sources (
  tenant_id, brand_id, name, source_kind, base_url, search_url_template,
  allowed_domains, supported_fields, image_usage_note, priority, status, last_verified_at
)
select b.tenant_id, b.id, 'Catálogo oficial KX3', 'official_catalog',
  'https://kx3.com.br', 'https://kx3.com.br/produtos/',
  array['kx3.com.br','www.kx3.com.br'],
  array['name','description','specifications','manufacturer_code','image','manual'],
  'Material obtido da fonte oficial. Confirmar autorização comercial/licença antes da publicação de imagens.',
  100, 'active', now()
from public.brands b where b.slug = 'kx3'
on conflict (tenant_id, brand_id, name) do update set
  source_kind = excluded.source_kind,
  base_url = excluded.base_url,
  search_url_template = excluded.search_url_template,
  allowed_domains = excluded.allowed_domains,
  supported_fields = excluded.supported_fields,
  image_usage_note = excluded.image_usage_note,
  priority = excluded.priority,
  status = 'active',
  last_verified_at = now(),
  last_error = null;

insert into public.manufacturer_catalog_sources (
  tenant_id, brand_id, name, source_kind, base_url, search_url_template,
  allowed_domains, supported_fields, image_usage_note, priority, status, last_verified_at
)
select b.tenant_id, b.id, 'Catálogo oficial Engates Brucke', 'official_catalog',
  'https://www.engatesbrucke.com.br', 'https://www.engatesbrucke.com.br/produtos/',
  array['engatesbrucke.com.br','www.engatesbrucke.com.br'],
  array['name','description','specifications','manufacturer_code','image','vehicle_application'],
  'Material obtido da fonte oficial. Confirmar autorização comercial/licença antes da publicação de imagens.',
  100, 'active', now()
from public.brands b where b.slug = 'brucke'
on conflict (tenant_id, brand_id, name) do update set
  source_kind = excluded.source_kind,
  base_url = excluded.base_url,
  search_url_template = excluded.search_url_template,
  allowed_domains = excluded.allowed_domains,
  supported_fields = excluded.supported_fields,
  image_usage_note = excluded.image_usage_note,
  priority = excluded.priority,
  status = 'active',
  last_verified_at = now(),
  last_error = null;

-- A linha Reforcel possui catálogo detalhado dentro do ecossistema oficial da Engates Brucke.
insert into public.manufacturer_catalog_sources (
  tenant_id, brand_id, name, source_kind, base_url, search_url_template,
  allowed_domains, supported_fields, image_usage_note, priority, status, last_verified_at
)
select b.tenant_id, b.id, 'Catálogo oficial Engates Reforcel', 'official_catalog',
  'https://www.engatesbrucke.com.br', 'https://www.engatesbrucke.com.br/produtos/?marcaProduto=Engates+Reforcel',
  array['engatesbrucke.com.br','www.engatesbrucke.com.br'],
  array['name','description','specifications','manufacturer_code','image','vehicle_application'],
  'Material obtido do catálogo oficial da linha Reforcel. Confirmar autorização comercial/licença antes da publicação de imagens.',
  100, 'active', now()
from public.brands b where b.slug = 'reforcel'
on conflict (tenant_id, brand_id, name) do update set
  source_kind = excluded.source_kind,
  base_url = excluded.base_url,
  search_url_template = excluded.search_url_template,
  allowed_domains = excluded.allowed_domains,
  supported_fields = excluded.supported_fields,
  image_usage_note = excluded.image_usage_note,
  priority = excluded.priority,
  status = 'active',
  last_verified_at = now(),
  last_error = null;

-- Mantém também o domínio institucional informado como fonte secundária e auditável.
insert into public.manufacturer_catalog_sources (
  tenant_id, brand_id, name, source_kind, base_url, search_url_template,
  allowed_domains, supported_fields, image_usage_note, priority, status, last_verified_at
)
select b.tenant_id, b.id, 'Site institucional Reforcel', 'official_site',
  'https://www.reforcel.com.br', 'https://www.reforcel.com.br',
  array['reforcel.com.br','www.reforcel.com.br'],
  array['name','description','specifications','image'],
  'Fonte institucional secundária; priorizar o catálogo estruturado da linha Reforcel antes desta fonte.',
  50, 'active', now()
from public.brands b where b.slug = 'reforcel'
on conflict (tenant_id, brand_id, name) do update set
  source_kind = excluded.source_kind,
  base_url = excluded.base_url,
  search_url_template = excluded.search_url_template,
  allowed_domains = excluded.allowed_domains,
  supported_fields = excluded.supported_fields,
  image_usage_note = excluded.image_usage_note,
  priority = excluded.priority,
  status = 'active',
  last_verified_at = now(),
  last_error = null;

commit;
