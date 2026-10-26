-- Storefront catalog quality guard.
-- Invalid commercial names stay in ERP/history but are never exposed online.

create or replace function private.product_name_is_storefront_safe(p_name text)
returns boolean
language sql
immutable
set search_path=''
as $$
  select
    nullif(btrim(coalesce(p_name,'')), '') is not null
    and lower(coalesce(p_name,'')) not like '%undefined%'
    and upper(btrim(coalesce(p_name,''))) not like 'INATIVAR%'
$$;

update public.products
set available_for_online=false,
    updated_at=now()
where available_for_online=true
  and not private.product_name_is_storefront_safe(name);

create or replace function private.enforce_storefront_catalog_quality()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.available_for_online
     and not private.product_name_is_storefront_safe(new.name) then
    new.available_for_online := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_storefront_catalog_quality on public.products;
create trigger trg_enforce_storefront_catalog_quality
before insert or update of name, available_for_online
on public.products
for each row
execute function private.enforce_storefront_catalog_quality();

comment on function private.product_name_is_storefront_safe(text)
is 'Returns true only when a product name is safe to expose in the public storefront.';

comment on function private.enforce_storefront_catalog_quality()
is 'Prevents products with placeholder/deactivation names from being published online.';
