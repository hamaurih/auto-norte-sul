-- Payment, cancellation, expiry and service-boundary tests. Fixtures roll back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'cliente-fase-1b5@example.invalid', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.brands (tenant_id, name, slug)
select id, 'Marca ciclo ' || environment, 'marca-ciclo'
from public.tenants where environment in ('production', 'demo');

insert into public.products (
  tenant_id, sku, name, slug, brand_id, price_b2c, stock, active
)
select tenant.id, 'SKU-CICLO', 'Produto ciclo ' || tenant.environment,
  'produto-ciclo', brand.id, 50, 10, true
from public.tenants tenant
join public.brands brand
  on brand.tenant_id = tenant.id and brand.slug = 'marca-ciclo'
where tenant.environment in ('production', 'demo');

insert into public.branches (tenant_id, name, code, active)
select id, 'Filial ciclo ' || environment, 'FIL-CICLO', true
from public.tenants where environment in ('production', 'demo');

insert into public.warehouses (
  tenant_id, branch_id, name, code, is_default, active
)
select branch.tenant_id, branch.id, 'Depósito ciclo', 'DEP-CICLO', true, true
from public.branches branch
join public.tenants tenant on tenant.id = branch.tenant_id
where branch.code = 'FIL-CICLO'
  and tenant.environment = 'demo';

set local role service_role;

do $test$
declare
  real_product uuid;
  paid_order uuid;
  cancelled_order uuid;
  expired_order uuid;
  stock_on_hand integer;
  stock_reserved integer;
  result_status public.order_status;
begin
  select product.id into real_product
  from public.products product
  join public.tenants tenant on tenant.id = product.tenant_id
  where tenant.environment = 'production' and product.slug = 'produto-ciclo';

  perform set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );
  paid_order := public.internal_create_storefront_order(
    '30000000-0000-0000-0000-000000000001',
    'norte-sul-real',
    '{"name":"Cliente 1B.5","email":"cliente-fase-1b5@example.invalid"}',
    jsonb_build_array(jsonb_build_object(
      'product_id', real_product, 'quantity', 2
    )),
    'pix',
    '31000000-0000-0000-0000-000000000001'
  );

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  result_status := public.internal_transition_order(
    paid_order, 'confirm_payment', null
  );
  if result_status <> 'pago' then
    raise exception 'Payment transition failed';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.internal_transition_order(paid_order, 'confirm_payment', null);

  select stock.on_hand, stock.reserved
  into stock_on_hand, stock_reserved
  from public.product_stock stock
  join public.stock_reservations reservation
    on reservation.tenant_id = stock.tenant_id
   and reservation.product_id = stock.product_id
   and reservation.warehouse_id = stock.warehouse_id
  where reservation.order_id = paid_order;

  if stock_on_hand <> 8 or stock_reserved <> 0 then
    raise exception 'Paid stock invariant failed: on hand %, reserved %',
      stock_on_hand, stock_reserved;
  end if;
  if (
    select count(*) from public.stock_movements movement
    where movement.reference = 'ORDER:' || paid_order::text
      and movement.type = 'OUT'
  ) <> 1 then
    raise exception 'Payment idempotency or movement logging failed';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  cancelled_order := public.internal_create_storefront_order(
    '30000000-0000-0000-0000-000000000001',
    'norte-sul-real',
    '{"name":"Cliente 1B.5","email":"cliente-fase-1b5@example.invalid"}',
    jsonb_build_array(jsonb_build_object(
      'product_id', real_product, 'quantity', 1
    )),
    'pix',
    '31000000-0000-0000-0000-000000000002'
  );
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  result_status := public.internal_transition_order(
    cancelled_order,
    'cancel',
    '30000000-0000-0000-0000-000000000001'
  );
  if result_status <> 'cancelado' then
    raise exception 'Cancellation transition failed';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  expired_order := public.internal_create_storefront_order(
    '30000000-0000-0000-0000-000000000001',
    'norte-sul-real',
    '{"name":"Cliente 1B.5","email":"cliente-fase-1b5@example.invalid"}',
    jsonb_build_array(jsonb_build_object(
      'product_id', real_product, 'quantity', 1
    )),
    'pix',
    '31000000-0000-0000-0000-000000000003'
  );
  update public.stock_reservations
  set expires_at = now() - interval '1 minute'
  where order_id = expired_order;

  if private.expire_stock_reservations() <> 1 then
    raise exception 'Automatic expiry did not process one order';
  end if;
  if (
    select status from public.orders where id = expired_order
  ) <> 'cancelado' then
    raise exception 'Expired order was not cancelled';
  end if;

  select stock.on_hand, stock.reserved
  into stock_on_hand, stock_reserved
  from public.product_stock stock
  join public.stock_reservations reservation
    on reservation.tenant_id = stock.tenant_id
   and reservation.product_id = stock.product_id
   and reservation.warehouse_id = stock.warehouse_id
  where reservation.order_id = paid_order;
  if stock_on_hand <> 8 or stock_reserved <> 0 then
    raise exception 'Release invariant failed after cancellation/expiry';
  end if;
end;
$test$;

reset role;

do $test$
begin
  if has_function_privilege(
    'anon',
    'public.internal_create_storefront_order(uuid,text,jsonb,jsonb,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute internal order creation';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.internal_create_storefront_order(uuid,text,jsonb,jsonb,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute internal order creation';
  end if;
  if to_regprocedure(
    'public.create_storefront_order(jsonb,jsonb,text,uuid)'
  ) is not null then
    raise exception 'legacy privileged RPC is still public';
  end if;
  if not exists (
    select 1 from cron.job
    where jobname = 'expire-auto-deal-stock-reservations'
      and schedule = '*/5 * * * *'
  ) then
    raise exception 'Reservation expiry cron is missing';
  end if;
end;
$test$;

rollback;
