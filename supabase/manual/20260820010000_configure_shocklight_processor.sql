-- Ponto inicial oficial usado pelo processador para percorrer o catálogo Shocklight.
update public.manufacturer_catalog_sources s
set search_url_template='https://www.shocklight.com.br/produtos/linha-completa/',updated_at=now()
from public.brands b
where b.id=s.brand_id and b.tenant_id=s.tenant_id
  and lower(b.name)='shocklight' and s.name='Site oficial Shocklight';
