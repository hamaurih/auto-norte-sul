-- Reverte somente códigos de fabricante preenchidos automaticamente quando o
-- mesmo código passou a representar produtos de nomes diferentes na mesma marca.
-- Código interno/SKU Norte Sul permanece intacto.

with tenant as (
  select id from public.tenants where slug='norte-sul-real' and status='active' limit 1
), p as (
  select p.id,p.brand_id,upper(btrim(p.manufacturer_code)) code,p.name
  from public.products p join tenant t on t.id=p.tenant_id
  where p.deleted_at is null and nullif(btrim(p.manufacturer_code),'') is not null
), bad_groups as (
  select brand_id,code from p group by brand_id,code
  having count(*)>1 and count(distinct upper(btrim(name)))>1
), targets as (
  select p.id,a.id audit_id,a.original_name,a.original_manufacturer_code
  from public.products p join tenant t on t.id=p.tenant_id
  join bad_groups g on g.brand_id=p.brand_id and g.code=upper(btrim(p.manufacturer_code))
  join public.product_code_normalization_audit a on a.product_id=p.id
  where p.deleted_at is null and a.status='applied'
    and a.reason like '%Código do fabricante extraído do início do nome%'
)
update public.products p
set manufacturer_code=t.original_manufacturer_code,
    name=coalesce(nullif(btrim(t.original_name),''),p.name),
    updated_at=now()
from targets t where p.id=t.id;

update public.product_code_normalization_audit a
set status='review_required',
    reason=concat_ws('; ',a.reason,'Revertido automaticamente: código entrou em conflito com outro produto de nome diferente na mesma marca'),
    reviewed_at=null, reviewed_by=null
where a.status='applied'
  and a.reason like '%Código do fabricante extraído do início do nome%'
  and a.original_manufacturer_code is null
  and exists (
    select 1 from public.products p
    where p.id=a.product_id and p.manufacturer_code is null and p.name=a.original_name
  );
