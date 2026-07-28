-- Inventory isolation, storefront visibility and cross-tenant integrity. Fixtures roll back.
begin;

insert into public.brands (tenant_id, name, slug)
select id, 'Marca estoque ' || environment, 'marca-estoque'
from public.tenants where environment in ('production', 'demo');

insert into public.products (tenant_id, sku, name, slug, brand_id, price_b2c, stock, active)
select tenant.id, 'SKU-ESTOQUE', 'Produto estoque ' || tenant.environment, 'produto-estoque',
  brand.id, 100, 3, true
from public.tenants tenant
join public.brands brand on brand.tenant_id = tenant.id and brand.slug = 'marca-estoque'
where tenant.environment in ('production', 'demo');

insert into public.branches (tenant_id, name, code, active)
select id, 'Filial estoque ' || environment, 'FIL-EST', true
from public.tenants where environment in ('production', 'demo');

insert into public.warehouses (tenant_id, branch_id, name, code, active)
select branch.tenant_id, branch.id, 'Depósito estoque', 'DEP-EST', true
from public.branches branch where branch.code = 'FIL-EST';

insert into public.product_stock (tenant_id, product_id, warehouse_id, on_hand, reserved)
select product.tenant_id, product.id, warehouse.id,
  case tenant.environment when 'production' then 11 else 22 end, 2
from public.products product
join public.tenants tenant on tenant.id = product.tenant_id
join public.warehouses warehouse on warehouse.tenant_id = product.tenant_id
where product.slug = 'produto-estoque' and warehouse.code = 'DEP-EST';

set local role anon;
select set_config('request.headers', '{"x-tenant-slug":"norte-sul-real"}', true);
do $test$
declare available integer; location_count integer;
begin
  select available_effective into available
  from public.v_product_stock_available
  where product_id = (
    select id from public.products where slug = 'produto-estoque'
  );
  if available <> 9 then
    raise exception 'Production stock isolation failed: %', available;
  end if;
  select count(*) into location_count
  from public.product_stock stock
  join public.warehouses warehouse on warehouse.id = stock.warehouse_id
  join public.branches branch on branch.id = warehouse.branch_id
  where stock.product_id = (
    select id from public.products where slug = 'produto-estoque'
  );
  if location_count <> 1 then
    raise exception 'Production stock location visibility failed: %', location_count;
  end if;
end;
$test$;

select set_config('request.headers', '{"x-tenant-slug":"norte-sul-demo"}', true);
do $test$
declare available integer;
begin
  select available_effective into available
  from public.v_product_stock_available
  where product_id = (
    select id from public.products where slug = 'produto-estoque'
  );
  if available <> 20 then
    raise exception 'Demo stock isolation failed: %', available;
  end if;
end;
$test$;

select set_config('request.headers', '{}', true);
do $test$
declare exposed integer;
begin
  select count(*) into exposed from public.v_product_stock_available;
  if exposed <> 0 then
    raise exception 'Missing storefront context exposed % stock rows', exposed;
  end if;
end;
$test$;

reset role;
do $test$
declare
  production_tenant uuid;
  production_product uuid;
  production_warehouse uuid;
  demo_product uuid;
  demo_warehouse uuid;
  transfer_id uuid;
begin
  select id into production_tenant from public.tenants where environment = 'production';
  select product.id into production_product from public.products product
    where product.tenant_id = production_tenant and product.slug = 'produto-estoque';
  select warehouse.id into production_warehouse from public.warehouses warehouse
    where warehouse.tenant_id = production_tenant and warehouse.code = 'DEP-EST';
  select product.id into demo_product from public.products product
    join public.tenants tenant on tenant.id = product.tenant_id
    where tenant.environment = 'demo' and product.slug = 'produto-estoque';
  select warehouse.id into demo_warehouse from public.warehouses warehouse
    join public.tenants tenant on tenant.id = warehouse.tenant_id
    where tenant.environment = 'demo' and warehouse.code = 'DEP-EST';

  begin
    insert into public.product_stock (tenant_id, product_id, warehouse_id, on_hand)
    values (production_tenant, production_product, demo_warehouse, 1);
    raise exception 'Cross-tenant warehouse stock was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.stock_movements (tenant_id, product_id, warehouse_id, type, qty)
    values (production_tenant, demo_product, production_warehouse, 'IN', 1);
    raise exception 'Cross-tenant product movement was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.stock_transfers (
      tenant_id, code, from_warehouse_id, to_warehouse_id
    ) values (
      production_tenant, 'TR-CROSS', production_warehouse, demo_warehouse
    );
    raise exception 'Cross-tenant transfer was accepted';
  exception when foreign_key_violation then null;
  end;

  insert into public.warehouses (tenant_id, branch_id, name, code, active)
  select production_tenant, branch.id, 'Depósito destino', 'DEP-DEST', true
  from public.branches branch
  where branch.tenant_id = production_tenant and branch.code = 'FIL-EST'
  returning id into demo_warehouse;

  insert into public.stock_transfers (
    tenant_id, code, from_warehouse_id, to_warehouse_id
  ) values (
    production_tenant, 'TR-VALID', production_warehouse, demo_warehouse
  ) returning id into transfer_id;

  begin
    insert into public.stock_transfer_items (tenant_id, transfer_id, product_id, qty)
    values (production_tenant, transfer_id, demo_product, 1);
    raise exception 'Cross-tenant transfer item was accepted';
  exception when foreign_key_violation then null;
  end;
end;
$test$;

rollback;
