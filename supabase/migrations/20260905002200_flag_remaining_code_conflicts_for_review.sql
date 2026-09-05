-- Não inventa códigos. Casos sem código interno Norte Sul confirmado e
-- códigos de fabricante conflitantes ficam na fila de revisão auditável.

with tenant as (
  select id from public.tenants where slug='norte-sul-real' and status='active' limit 1
), p as (
  select p.* from public.products p join tenant t on t.id=p.tenant_id where p.deleted_at is null
), mfr_groups as (
  select brand_id,upper(btrim(manufacturer_code)) code
  from p where brand_id is not null and nullif(btrim(manufacturer_code),'') is not null
  group by brand_id,upper(btrim(manufacturer_code))
  having count(*)>1 and count(distinct upper(btrim(name)))>1
), raw_targets as (
  select p.id product_id,'Código interno Norte Sul não confirmado: SKU não segue prefixo AZ-/F-; não gerar código automaticamente'::text reason
  from p where nullif(btrim(p.internal_code),'') is null and p.sku !~* '^(AZ|F)-'
  union all
  select p.id,'Código do fabricante repetido na mesma marca em produtos com nomes diferentes; requer validação do catálogo do fabricante'::text
  from p join mfr_groups g on g.brand_id=p.brand_id and g.code=upper(btrim(p.manufacturer_code))
), targets as (
  select product_id,string_agg(distinct reason,'; ' order by reason) reason
  from raw_targets group by product_id
)
insert into public.product_code_normalization_audit(
  tenant_id,product_id,original_sku,original_name,original_internal_code,original_manufacturer_code,
  proposed_name,proposed_internal_code,proposed_manufacturer_code,status,reason
)
select p.tenant_id,p.id,p.sku,p.name,p.internal_code,p.manufacturer_code,
       p.name,p.internal_code,p.manufacturer_code,'review_required',t.reason
from targets t join p on p.id=t.product_id
on conflict (product_id) do nothing;

with tenant as (
  select id from public.tenants where slug='norte-sul-real' and status='active' limit 1
), p as (
  select p.* from public.products p join tenant t on t.id=p.tenant_id where p.deleted_at is null
), mfr_groups as (
  select brand_id,upper(btrim(manufacturer_code)) code
  from p where brand_id is not null and nullif(btrim(manufacturer_code),'') is not null
  group by brand_id,upper(btrim(manufacturer_code))
  having count(*)>1 and count(distinct upper(btrim(name)))>1
), raw_targets as (
  select p.id product_id,'Código interno Norte Sul não confirmado: SKU não segue prefixo AZ-/F-; não gerar código automaticamente'::text reason
  from p where nullif(btrim(p.internal_code),'') is null and p.sku !~* '^(AZ|F)-'
  union all
  select p.id,'Código do fabricante repetido na mesma marca em produtos com nomes diferentes; requer validação do catálogo do fabricante'::text
  from p join mfr_groups g on g.brand_id=p.brand_id and g.code=upper(btrim(p.manufacturer_code))
), targets as (
  select product_id,string_agg(distinct reason,'; ' order by reason) reason
  from raw_targets group by product_id
)
update public.product_code_normalization_audit a
set status=case when a.status='reverted' then a.status else 'review_required' end,
    reason=case when position(t.reason in coalesce(a.reason,''))>0 then a.reason else concat_ws('; ',a.reason,t.reason) end,
    reviewed_at=case when a.status='reverted' then a.reviewed_at else null end,
    reviewed_by=case when a.status='reverted' then a.reviewed_by else null end
from targets t where a.product_id=t.product_id;
