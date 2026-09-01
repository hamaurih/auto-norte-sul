-- Ampliação das fontes oficiais da Central de Catálogos de Fabricantes.
-- Vincula apenas produtos sem marca cujo próprio nome termina com o fabricante.
begin;

with target_tenants as (
  select distinct tenant_id
  from public.manufacturer_catalog_sources
),
new_brands(name, slug) as (
  values
    ('Universal', 'universal'),
    ('Fiamon', 'fiamon'),
    ('Clube Euro', 'clube-euro'),
    ('Ecoflex', 'ecoflex'),
    ('TopMix', 'topmix'),
    ('Elitte', 'elitte'),
    ('NAT', 'nat'),
    ('DSC', 'dsc'),
    ('Serauto', 'serauto')
)
insert into public.brands (tenant_id, name, slug, featured)
select t.tenant_id, b.name, b.slug, false
from target_tenants t
cross join new_brands b
on conflict (tenant_id, slug) do update set name = excluded.name;

with brand_patterns(slug, pattern) as (
  values
    ('universal', '[-[:space:]]UNIVERSAL[[:space:]]*$'),
    ('fiamon', '[-[:space:]]FIAMON[[:space:]]*$'),
    ('clube-euro', '[-[:space:]]CLUBE[ -]?EURO[[:space:]]*$'),
    ('ecoflex', '[-[:space:]]ECOFLEX[[:space:]]*$'),
    ('topmix', '[-[:space:]]TOP[ -]?MIX[[:space:]]*$'),
    ('elitte', '[-[:space:]]ELITTE[[:space:]]*$'),
    ('nat', '[-[:space:]]NAT[[:space:]]*$'),
    ('dsc', '[-[:space:]]DSC[[:space:]]*$'),
    ('serauto', '[-[:space:]]SERAUTO[[:space:]]*$')
)
update public.products p
set brand_id = b.id, updated_at = now()
from public.brands b
join brand_patterns bp on bp.slug = b.slug
where p.brand_id is null
  and p.tenant_id = b.tenant_id
  and p.name ~* bp.pattern;

with source_rows(
  slug, name, source_kind, base_url, search_url_template, allowed_domains,
  supported_fields, image_usage_note, priority, status, last_error
) as (
  values
    (
      'universal', 'Catálogo oficial Universal Automotive', 'official_catalog',
      'https://www.universalautomotive.com.br',
      'https://www.universalautomotive.com.br/{code}?_q={code}&map=ft',
      array['universalautomotive.com.br','www.universalautomotive.com.br']::text[],
      array['name','description','specifications','manufacturer_code','gtin','image','vehicle_application']::text[],
      'Fonte oficial do fabricante. Imagens devem permanecer em revisão e ser copiadas para o Storage próprio antes da publicação.',
      100, 'active', null
    ),
    (
      'fiamon', 'Catálogo oficial Fiamon', 'official_catalog',
      'https://www.fiamon.com.br',
      'https://www.fiamon.com.br/pt/busca/?busca={code_raw}&buscar=',
      array['fiamon.com.br','www.fiamon.com.br']::text[],
      array['name','description','specifications','manufacturer_code','image','vehicle_application','manual']::text[],
      'Fonte oficial do fabricante. Manter revisão humana para variações de cor que compartilham a mesma página.',
      100, 'active', null
    ),
    (
      'nat', 'Catálogo oficial NAT', 'official_catalog',
      'https://natindustria.com.br',
      'https://natindustria.com.br/?s={code_raw}',
      array['natindustria.com.br','www.natindustria.com.br']::text[],
      array['name','description','specifications','manufacturer_code','image','vehicle_application']::text[],
      'Fonte oficial do fabricante. Manter revisão humana quando uma página apresentar mais de um código ou lado da peça.',
      100, 'active', null
    ),
    (
      'dsc', 'Catálogo oficial DSC', 'official_catalog',
      'https://dsc.ind.br',
      'https://dsc.ind.br/?s={code_raw}',
      array['dsc.ind.br','www.dsc.ind.br']::text[],
      array['name','description','specifications','manufacturer_code','image','vehicle_application','manual']::text[],
      'Fonte oficial DSC, incluindo páginas de produto e materiais de apoio disponibilizados pelo fabricante.',
      100, 'active', null
    ),
    (
      'serauto', 'Catálogo oficial Serauto Plásticos', 'official_catalog',
      'https://www.serautoplasticos.com.br',
      'https://www.serautoplasticos.com.br/?s={code_raw}',
      array['serautoplasticos.com.br','www.serautoplasticos.com.br']::text[],
      array['name','description','specifications','manufacturer_code','image','vehicle_application']::text[],
      'Domínio oficial corrigido para serautoplasticos.com.br (plural). Revisar produtos com múltiplos códigos na mesma página.',
      100, 'active', null
    ),
    (
      'elitte', 'Catálogo oficial Elitte Motors', 'official_catalog',
      'https://www.elittemotors.com.br',
      'https://www.elittemotors.com.br/produtos',
      array['elittemotors.com.br','www.elittemotors.com.br']::text[],
      array['name','description','specifications','manufacturer_code','image']::text[],
      'Catálogo oficial em página única. O conector isola o item pelo código e mantém a imagem em revisão.',
      100, 'active', null
    ),
    (
      'topmix', 'Catálogo PDF oficial TopMix', 'manual',
      'https://www.topmixautomotive.com.br',
      'https://www.topmixautomotive.com.br/images/catalogo/catalogo-top-mix.pdf',
      array['topmixautomotive.com.br','www.topmixautomotive.com.br']::text[],
      array['name','description','specifications','manufacturer_code','image','vehicle_application']::text[],
      'Catálogo oficial disponível apenas em PDF. Fonte registrada para consulta; automação pausada até o importador de PDF ser habilitado.',
      70, 'paused', 'Catálogo oficial em PDF; exige processamento específico de PDF.'
    ),
    (
      'ecoflex', 'Catálogo oficial Ecoflex Automotive', 'manual',
      'https://www.ecoflexautomotive.com.br',
      'https://www.ecoflexautomotive.com.br/calhas-automotivas',
      array['ecoflexautomotive.com.br','www.ecoflexautomotive.com.br']::text[],
      array['name','description','specifications','manufacturer_code','image','vehicle_application']::text[],
      'Fonte oficial registrada para consulta. O site retornou indisponibilidade durante a validação de 01/09/2026.',
      60, 'paused', 'Site oficial respondeu 502 durante a validação; não automatizar até nova verificação.'
    ),
    (
      'clube-euro', 'Catálogo oficial Clube Euro', 'manual',
      'https://www.clubeeuro.com.br',
      'https://www.clubeeuro.com.br',
      array['clubeeuro.com.br','www.clubeeuro.com.br']::text[],
      array['name','description','specifications','manufacturer_code','image','vehicle_application']::text[],
      'Catálogo oficial implementado como aplicação Flutter/Firebase. Fonte registrada para consulta; requer feed/API autorizado para automação confiável.',
      60, 'paused', 'Aplicação dinâmica sem catálogo HTML estático; aguarda feed/API oficial.'
    )
)
insert into public.manufacturer_catalog_sources (
  tenant_id, brand_id, name, source_kind, base_url, search_url_template,
  allowed_domains, supported_fields, image_usage_note, priority, status,
  last_verified_at, last_error
)
select
  b.tenant_id, b.id, s.name, s.source_kind, s.base_url, s.search_url_template,
  s.allowed_domains, s.supported_fields, s.image_usage_note, s.priority, s.status,
  now(), s.last_error
from source_rows s
join public.brands b on b.slug = s.slug
where exists (
  select 1 from public.manufacturer_catalog_sources existing
  where existing.tenant_id = b.tenant_id
)
on conflict (tenant_id, brand_id, name) do update set
  source_kind = excluded.source_kind,
  base_url = excluded.base_url,
  search_url_template = excluded.search_url_template,
  allowed_domains = excluded.allowed_domains,
  supported_fields = excluded.supported_fields,
  image_usage_note = excluded.image_usage_note,
  priority = excluded.priority,
  status = excluded.status,
  last_verified_at = excluded.last_verified_at,
  last_error = excluded.last_error,
  updated_at = now();

commit;
