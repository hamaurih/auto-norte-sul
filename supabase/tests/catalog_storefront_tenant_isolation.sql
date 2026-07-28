-- Storefront isolation and cross-tenant integrity test. All fixtures are rolled back.
begin;

insert into public.brands (tenant_id, name, slug)
select id, 'Marca ' || environment, 'marca-teste'
from public.tenants where environment in ('production','demo');

insert into public.categories (tenant_id, name, slug)
select id, 'Categoria ' || environment, 'categoria-teste'
from public.tenants where environment in ('production','demo');

insert into public.products (
  tenant_id, sku, name, slug, brand_id, category_id,
  price_b2c, price_b2b, internal_code, bling_id, stock, active
)
select tenant.id, 'SKU-IGUAL', 'Produto ' || tenant.environment, 'produto-teste',
  brand.id, category.id, 100, 70, 'INTERNO-SECRETO', 'BLING-SECRETO', 10, true
from public.tenants tenant
join public.brands brand on brand.tenant_id = tenant.id and brand.slug = 'marca-teste'
join public.categories category on category.tenant_id = tenant.id and category.slug = 'categoria-teste'
where tenant.environment in ('production','demo');

insert into public.product_images (tenant_id, product_id, url, is_primary)
select tenant_id, id, 'https://example.invalid/' || tenant_id || '.jpg', true
from public.products where slug = 'produto-teste';
insert into public.product_applications (tenant_id, product_id, vehicle_make, vehicle_model)
select tenant_id, id, 'Chevrolet', 'Onix'
from public.products where slug = 'produto-teste';

set local role anon;
select set_config('request.headers', '{"x-tenant-slug":"norte-sul-real"}', true);
do $$
declare product_count integer; brand_count integer; category_count integer; image_count integer; application_count integer;
begin
  select count(*) into product_count from public.products where slug = 'produto-teste';
  select count(*) into brand_count from public.brands where slug = 'marca-teste';
  select count(*) into category_count from public.categories where slug = 'categoria-teste';
  select count(*) into image_count from public.product_images;
  select count(*) into application_count from public.product_applications;
  if product_count <> 1 or brand_count <> 1 or category_count <> 1 or image_count <> 1 or application_count <> 1 then
    raise exception 'Production storefront isolation failed';
  end if;
end;
$$;

select set_config('request.headers', '{"x-tenant-slug":"norte-sul-demo"}', true);
do $$
declare product_name text; product_count integer;
begin
  select count(*), min(name) into product_count, product_name
  from public.products where slug = 'produto-teste';
  if product_count <> 1 or product_name <> 'Produto demo' then
    raise exception 'Demo storefront isolation failed: count %, name %', product_count, product_name;
  end if;
end;
$$;

select set_config('request.headers', '{}', true);
do $$
declare product_count integer;
begin
  select count(*) into product_count from public.products;
  if product_count <> 0 then
    raise exception 'Missing storefront context exposed % products', product_count;
  end if;
end;
$$;

reset role;
do $$
declare production_tenant uuid; demo_brand uuid;
begin
  select id into production_tenant from public.tenants where environment = 'production';
  select brand.id into demo_brand
  from public.brands brand
  join public.tenants tenant on tenant.id = brand.tenant_id
  where tenant.environment = 'demo' and brand.slug = 'marca-teste';
  begin
    insert into public.products (tenant_id, sku, name, slug, brand_id, price_b2c, stock)
    values (production_tenant, 'CROSS-TENANT', 'Inválido', 'invalido', demo_brand, 1, 1);
    raise exception 'Cross-tenant brand association was accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;

rollback;
