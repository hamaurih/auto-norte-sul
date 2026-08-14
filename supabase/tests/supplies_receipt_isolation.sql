-- Suprimentos: isolamento por tenant, postagem transacional e idempotência
-- do recebimento. Todas as fixtures são revertidas (rollback no final).
begin;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'supplies-prod-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
 ('a2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'supplies-demo-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.tenant_memberships (tenant_id, user_id, role)
select id, 'a1000000-0000-0000-0000-000000000001', 'admin'
from public.tenants where environment = 'production';
insert into public.tenant_memberships (tenant_id, user_id, role)
select id, 'a2000000-0000-0000-0000-000000000002', 'admin'
from public.tenants where environment = 'demo';

-- Catálogo mínimo por tenant
insert into public.brands (tenant_id, name, slug)
select id, 'Marca suprimentos', 'marca-suprimentos'
from public.tenants where environment in ('production', 'demo');

insert into public.products (tenant_id, sku, name, slug, brand_id, price_b2c, active)
select tenant.id, 'SKU-SUPRI', 'Produto suprimentos', 'produto-suprimentos',
  brand.id, 250, true
from public.tenants tenant
join public.brands brand on brand.tenant_id = tenant.id and brand.slug = 'marca-suprimentos'
where tenant.environment in ('production', 'demo');

insert into public.branches (tenant_id, name, code, active)
select id, 'Filial suprimentos', 'FIL-SUP', true
from public.tenants where environment in ('production', 'demo');

insert into public.warehouses (tenant_id, branch_id, name, code, active)
select branch.tenant_id, branch.id, 'Depósito suprimentos', 'DEP-SUP', true
from public.branches branch where branch.code = 'FIL-SUP';

insert into public.product_stock (tenant_id, product_id, warehouse_id, on_hand, reserved)
select product.tenant_id, product.id, warehouse.id, 4, 0
from public.products product
join public.warehouses warehouse
  on warehouse.tenant_id = product.tenant_id and warehouse.code = 'DEP-SUP'
where product.slug = 'produto-suprimentos';

-- Fornecedor, pedido e recebimento em rascunho para os dois tenants
insert into public.suppliers (tenant_id, legal_name, trade_name, active)
select id, 'Fornecedor teste ' || environment, 'Fornecedor', true
from public.tenants where environment in ('production', 'demo');

insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id, status, items_total, total_amount)
select supplier.tenant_id,
  private.next_supply_number(supplier.tenant_id, 'purchase_order'),
  supplier.id, warehouse.id, 'sent', 600, 600
from public.suppliers supplier
join public.warehouses warehouse
  on warehouse.tenant_id = supplier.tenant_id and warehouse.code = 'DEP-SUP'
where supplier.legal_name like 'Fornecedor teste %';

insert into public.purchase_order_items (tenant_id, purchase_order_id, product_id, ordered_qty, unit_cost, line_total)
select po.tenant_id, po.id, product.id, 6, 100, 600
from public.purchase_orders po
join public.products product
  on product.tenant_id = po.tenant_id and product.slug = 'produto-suprimentos';

insert into public.goods_receipts (tenant_id, number, purchase_order_id, supplier_id, warehouse_id, status)
select po.tenant_id,
  private.next_supply_number(po.tenant_id, 'goods_receipt'),
  po.id, po.supplier_id, po.warehouse_id, 'draft'
from public.purchase_orders po
join public.suppliers supplier on supplier.id = po.supplier_id
where supplier.legal_name like 'Fornecedor teste %';

insert into public.goods_receipt_items (tenant_id, goods_receipt_id, purchase_order_item_id, product_id, accepted_qty, unit_cost)
select receipt.tenant_id, receipt.id, item.id, item.product_id, 4, 120
from public.goods_receipts receipt
join public.purchase_order_items item
  on item.purchase_order_id = receipt.purchase_order_id;

-- ============================================================
-- 1. Isolamento: admin de produção vê apenas os próprios registros
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $test$
declare suppliers_seen integer; orders_seen integer; receipts_seen integer;
begin
  select count(*) into suppliers_seen from public.suppliers;
  select count(*) into orders_seen from public.purchase_orders;
  select count(*) into receipts_seen from public.goods_receipts;
  if suppliers_seen <> 1 or orders_seen <> 1 or receipts_seen <> 1 then
    raise exception 'Supplies isolation failed: suppliers %, orders %, receipts %',
      suppliers_seen, orders_seen, receipts_seen;
  end if;
end;
$test$;

-- ============================================================
-- 2. Postagem transacional: estoque, custo, movimento e idempotência
-- ============================================================
do $test$
declare
  receipt_id uuid;
  target_product uuid;
  on_hand_after numeric;
  avg_cost numeric;
  movements integer;
  cost_rows integer;
  order_status text;
begin
  select id into receipt_id from public.goods_receipts limit 1;
  select id into target_product from public.products where slug = 'produto-suprimentos' limit 1;

  perform public.confirm_goods_receipt(receipt_id);

  select on_hand into on_hand_after from public.product_stock
  where product_id = target_product;
  if on_hand_after <> 8 then
    raise exception 'Receipt posting failed: on_hand %', on_hand_after;
  end if;

  select average_cost into avg_cost from public.products where id = target_product;
  if avg_cost is null or avg_cost <= 0 then
    raise exception 'Weighted average cost not written: %', avg_cost;
  end if;

  select count(*) into movements from public.stock_movements
  where product_id = target_product;
  if movements <> 1 then
    raise exception 'Stock movement count wrong: %', movements;
  end if;

  select count(*) into cost_rows from public.product_cost_history
  where product_id = target_product;
  if cost_rows <> 1 then
    raise exception 'Cost history count wrong: %', cost_rows;
  end if;

  select status into order_status from public.purchase_orders
  where id = (select purchase_order_id from public.goods_receipts where id = receipt_id);
  if order_status <> 'partially_received' then
    raise exception 'Purchase order status wrong: %', order_status;
  end if;

  -- Idempotência: segunda confirmação não pode duplicar estoque/movimentos
  begin
    perform public.confirm_goods_receipt(receipt_id);
  exception when others then
    null;
  end;

  select on_hand into on_hand_after from public.product_stock where product_id = target_product;
  select count(*) into movements from public.stock_movements where product_id = target_product;
  if on_hand_after <> 8 or movements <> 1 then
    raise exception 'Receipt confirmation is not idempotent: on_hand %, movements %',
      on_hand_after, movements;
  end if;
end;
$test$;

-- ============================================================
-- 3. Estorno devolve o estoque e reabre o pedido
-- ============================================================
do $test$
declare receipt_id uuid; target_product uuid; on_hand_after numeric; receipt_status text;
begin
  select id into receipt_id from public.goods_receipts limit 1;
  select id into target_product from public.products where slug = 'produto-suprimentos' limit 1;

  perform public.reverse_goods_receipt(receipt_id, 'Teste automatizado');

  select on_hand into on_hand_after from public.product_stock where product_id = target_product;
  select status into receipt_status from public.goods_receipts where id = receipt_id;
  if on_hand_after <> 4 or receipt_status <> 'reversed' then
    raise exception 'Reversal failed: on_hand %, status %', on_hand_after, receipt_status;
  end if;
end;
$test$;

-- ============================================================
-- 4. Anon não pode ler nem executar as funções de suprimentos
-- ============================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $test$
declare visible integer; blocked boolean := false;
begin
  begin
    select count(*) into visible from public.suppliers;
  exception when insufficient_privilege then
    visible := 0;
  end;
  if visible <> 0 then
    raise exception 'Anon can read suppliers: %', visible;
  end if;

  begin
    perform public.confirm_goods_receipt('00000000-0000-0000-0000-000000000000');
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception 'Anon can execute confirm_goods_receipt';
  end if;
end;
$test$;

rollback;
