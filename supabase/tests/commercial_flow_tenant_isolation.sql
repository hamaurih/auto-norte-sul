-- Commercial flow isolation, server-side pricing and atomic stock reservation.
-- All fixtures are rolled back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'cliente-fase-1b4@example.invalid', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.brands (tenant_id, name, slug)
select id, 'Marca comercial ' || environment, 'marca-comercial'
from public.tenants where environment in ('production', 'demo');

insert into public.products (
  tenant_id, sku, name, slug, brand_id,
  price_b2c, price_b2b, stock, active
)
select tenant.id, 'SKU-COMERCIAL', 'Produto comercial ' || tenant.environment,
  'produto-comercial', brand.id,
  case tenant.environment when 'production' then 100 else 200 end,
  case tenant.environment when 'production' then 80 else 160 end,
  10, true
from public.tenants tenant
join public.brands brand
  on brand.tenant_id = tenant.id and brand.slug = 'marca-comercial'
where tenant.environment in ('production', 'demo');

insert into public.branches (tenant_id, name, code, active)
select id, 'Filial comercial ' || environment, 'FIL-COM', true
from public.tenants where environment in ('production', 'demo');

insert into public.warehouses (
  tenant_id, branch_id, name, code, is_default, active
)
select branch.tenant_id, branch.id, 'Depósito comercial', 'DEP-COM', false, true
from public.branches branch where branch.code = 'FIL-COM';

insert into public.product_stock (
  tenant_id, product_id, warehouse_id, on_hand, reserved
)
select product.tenant_id, product.id, warehouse.id, 10, 0
from public.products product
join public.warehouses warehouse
  on warehouse.tenant_id = product.tenant_id
  and warehouse.is_default
  and warehouse.active
where product.slug = 'produto-comercial';

set local role service_role;

do $test$
declare
  selected_product_id uuid;
  created_order_id uuid;
  repeated_order_id uuid;
  recorded_price numeric;
  recorded_total numeric;
  reserved_quantity integer;
begin
  select id into selected_product_id
  from public.products where slug = 'produto-comercial';

  created_order_id := public.internal_create_storefront_order(
    '10000000-0000-0000-0000-000000000001',
    'norte-sul-real',
    jsonb_build_object(
      'name', 'Cliente Fase 1B.4',
      'email', 'cliente-fase-1b4@example.invalid',
      'phone', '83999999999',
      'document', '12345678901',
      'shipping_zip', '58400000',
      'shipping_street', 'Rua Teste',
      'shipping_number', '10',
      'shipping_neighborhood', 'Centro',
      'shipping_city', 'Campina Grande',
      'shipping_state', 'PB'
    ),
    jsonb_build_array(jsonb_build_object(
      'product_id', selected_product_id,
      'quantity', 2,
      'unit_price', 0.01
    )),
    'pix',
    '20000000-0000-0000-0000-000000000001'
  );

  repeated_order_id := public.internal_create_storefront_order(
    '10000000-0000-0000-0000-000000000001',
    'norte-sul-real',
    jsonb_build_object(
      'name', 'Cliente Fase 1B.4',
      'email', 'cliente-fase-1b4@example.invalid'
    ),
    jsonb_build_array(jsonb_build_object(
      'product_id', selected_product_id,
      'quantity', 2
    )),
    'pix',
    '20000000-0000-0000-0000-000000000001'
  );

  if repeated_order_id <> created_order_id then
    raise exception 'Idempotency failed';
  end if;

  select item.unit_price, item.total
  into recorded_price, recorded_total
  from public.order_items item
  where item.order_id = created_order_id;

  if recorded_price <> 100 or recorded_total <> 200 then
    raise exception 'Server-side pricing failed: price %, total %',
      recorded_price, recorded_total;
  end if;

  select stock.reserved into reserved_quantity
  from public.product_stock stock
  where stock.product_id = selected_product_id;

  if reserved_quantity <> 2 then
    raise exception 'Stock reservation failed: %', reserved_quantity;
  end if;

  if (select count(*) from public.orders sale where sale.id = created_order_id) <> 1
    or (select count(*) from public.stock_reservations reservation
        where reservation.order_id = created_order_id) <> 1
  then
    raise exception 'Atomic order records are incomplete';
  end if;
end;
$test$;

do $test$
declare demo_product uuid;
begin
  select product.id into demo_product
  from public.products product
  join public.tenants tenant on tenant.id = product.tenant_id
  where tenant.environment = 'demo' and product.slug = 'produto-comercial';

  begin
    perform public.internal_create_storefront_order(
      '10000000-0000-0000-0000-000000000001',
      'norte-sul-real',
      '{"name":"Cross tenant","email":"cross@example.invalid"}',
      jsonb_build_array(jsonb_build_object(
        'product_id', demo_product,
        'quantity', 1
      )),
      'pix',
      '20000000-0000-0000-0000-000000000002'
    );
    raise exception 'Cross-tenant storefront order was accepted';
  exception when raise_exception then
    if sqlerrm = 'Cross-tenant storefront order was accepted' then
      raise;
    end if;
  end;
end;
$test$;

reset role;

do $test$
declare
  production_tenant uuid;
  demo_tenant uuid;
  production_order uuid;
  demo_product uuid;
begin
  select id into production_tenant from public.tenants where environment = 'production';
  select id into demo_tenant from public.tenants where environment = 'demo';
  select id into production_order from public.orders
    where tenant_id = production_tenant limit 1;
  select product.id into demo_product
  from public.products product
  where product.tenant_id = demo_tenant and product.slug = 'produto-comercial';

  begin
    insert into public.order_items (
      tenant_id, order_id, product_id, sku, name, quantity, unit_price, total
    )
    values (
      production_tenant, production_order, demo_product,
      'CROSS', 'Inválido', 1, 1, 1
    );
    raise exception 'Cross-tenant order item was accepted';
  exception when foreign_key_violation then null;
  end;
end;
$test$;

rollback;
