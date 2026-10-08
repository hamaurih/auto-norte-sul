-- Atualiza pontos de entrada oficiais verificados em 08/10/2026.
update public.manufacturer_catalog_sources
set base_url='https://gridcalotas.com.br',
    search_url_template='https://gridcalotas.com.br/produtos/',
    allowed_domains=array['gridcalotas.com.br','www.gridcalotas.com.br'],
    last_error=null,
    updated_at=now()
where id='ca3ce666-9287-4238-b32f-bf45452fd81f';

update public.manufacturer_catalog_sources
set search_url_template='https://www.fiamon.com.br/pt/produtos/',
    last_error=null,
    updated_at=now()
where id='ba76ca10-d604-4323-9560-7f7946e656d8';

update public.manufacturer_catalog_sources
set search_url_template='https://www.shocklight.com.br/produtos/',
    last_error=null,
    updated_at=now()
where id='a094e6e9-dc1a-48db-a931-b68f531ef29c';

update public.manufacturer_catalog_sources
set allowed_domains=array['grupotiger.com.br','www.grupotiger.com.br','tigerauto.catalogofraga.com.br'],
    last_error=null,
    updated_at=now()
where id='f04c8e1e-2234-4953-924f-cbf40861a719';
