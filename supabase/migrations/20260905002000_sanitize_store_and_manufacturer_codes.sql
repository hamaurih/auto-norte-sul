-- Separa definitivamente código interno Norte Sul de código do fabricante.
-- Idempotente para a Conta Real: AZ-/F- pertencem ao código interno; fabricante
-- só é promovido do início do nome quando há marca confirmada e padrão histórico.

do $$
begin
  if not exists (select 1 from public.tenants where slug='norte-sul-real' and status='active') then
    raise exception 'Tenant norte-sul-real não encontrado';
  end if;
end $$;

create temporary table code_sanitation_plan on commit drop as
with tenant as (
  select id from public.tenants where slug='norte-sul-real' and status='active' limit 1
), existing as (
  select p.brand_id,
         regexp_replace(regexp_replace(upper(btrim(p.manufacturer_code)),'[A-Z]','A','g'),'[0-9]','9','g') sig,
         count(*) n
  from public.products p, tenant t
  where p.tenant_id=t.id and p.deleted_at is null and p.brand_id is not null
    and nullif(btrim(p.manufacturer_code),'') is not null
  group by p.brand_id,2
), base as (
  select p.id,p.tenant_id,p.sku,p.name,p.internal_code,p.manufacturer_code,p.brand_id,b.name brand_name,
         case when p.sku ~* '^(AZ|F)-'
              then upper(regexp_replace(replace(btrim(p.sku), '\t',''), '[[:space:]]+', '', 'g'))
              else upper(btrim(p.sku)) end cleaned_sku,
         (regexp_match(btrim(p.name), '^([A-Za-z0-9][A-Za-z0-9._/-]{2,})\s+(.+)$'))[1] token,
         (regexp_match(btrim(p.name), '^([A-Za-z0-9][A-Za-z0-9._/-]{2,})\s+(.+)$'))[2] rest,
         regexp_replace(upper(coalesce(regexp_replace(p.name,'^.*-\s*','','g'),'')), '[^A-Z0-9]', '', 'g') suffix_norm,
         regexp_replace(upper(coalesce(b.name,'')), '[^A-Z0-9]', '', 'g') brand_norm
  from public.products p join tenant t on t.id=p.tenant_id
  left join public.brands b on b.id=p.brand_id
  where p.deleted_at is null
), classified as (
  select base.*,
         regexp_replace(regexp_replace(upper(coalesce(token,'')),'[A-Z]','A','g'),'[0-9]','9','g') token_sig,
         (sku ~* '^(AZ|F)-' and (nullif(btrim(internal_code),'') is null or upper(btrim(internal_code))=upper(btrim(sku)))) can_sync_internal,
         (sku ~* '^(AZ|F)-' and cleaned_sku<>upper(btrim(sku))) sku_needs_cleanup
  from base
), final as (
  select c.*,
         (nullif(btrim(manufacturer_code),'') is null and token is not null and token ~ '[0-9]'
          and token !~* '^(AZ|F)-' and rest is not null and btrim(rest)<>''
          and brand_id is not null and brand_norm<>'' and suffix_norm=brand_norm
          and exists(select 1 from existing e where e.brand_id=c.brand_id and e.sig=c.token_sig and e.n>=3)) safe_mfr,
         (nullif(btrim(manufacturer_code),'') is null and token is not null and token ~ '[0-9]'
          and token !~* '^(AZ|F)-' and rest is not null and btrim(rest)<>'') any_mfr_candidate
  from classified c
)
select *,
       case when can_sync_internal then cleaned_sku else internal_code end proposed_internal,
       case when safe_mfr or any_mfr_candidate then upper(btrim(token)) else manufacturer_code end proposed_mfr,
       case when safe_mfr or any_mfr_candidate then btrim(rest) else name end proposed_name,
       case when any_mfr_candidate and not safe_mfr then 'review_required' else 'applied' end audit_status
from final
where (can_sync_internal and (internal_code is null or upper(btrim(internal_code))<>cleaned_sku))
   or sku_needs_cleanup or safe_mfr or (any_mfr_candidate and not safe_mfr);

insert into public.product_code_normalization_audit(
  tenant_id,product_id,original_sku,original_name,original_internal_code,original_manufacturer_code,
  proposed_name,proposed_internal_code,proposed_manufacturer_code,status,reason
)
select tenant_id,id,sku,name,internal_code,manufacturer_code,proposed_name,proposed_internal,proposed_mfr,audit_status,
       concat_ws('; ',
         case when sku_needs_cleanup then 'SKU Norte Sul normalizado: tabulação/espaço espúrio removido' end,
         case when can_sync_internal and (internal_code is null or upper(btrim(internal_code))<>cleaned_sku) then 'Código interno sincronizado a partir do SKU Norte Sul (AZ-/F-)' end,
         case when safe_mfr then 'Código do fabricante extraído do início do nome: marca final confirmada e formato respaldado por pelo menos 3 códigos existentes da mesma marca' end,
         case when any_mfr_candidate and not safe_mfr then 'Possível código de fabricante no início do nome; evidência insuficiente para aplicação automática' end)
from code_sanitation_plan
on conflict (product_id) do nothing;

update public.products p
set sku=plan.cleaned_sku, internal_code=plan.cleaned_sku, updated_at=now()
from code_sanitation_plan plan
where p.id=plan.id and plan.can_sync_internal
  and (p.internal_code is null or upper(btrim(p.internal_code))<>plan.cleaned_sku or upper(btrim(p.sku))<>plan.cleaned_sku);

update public.products p
set manufacturer_code=plan.proposed_mfr, name=plan.proposed_name, updated_at=now()
from code_sanitation_plan plan
where p.id=plan.id and plan.safe_mfr;
