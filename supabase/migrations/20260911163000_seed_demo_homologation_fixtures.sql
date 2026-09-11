-- Minimal, synthetic dataset for controlled homologation.
-- Scope is intentionally limited to the tenant whose environment = 'demo'.
-- No production customer, supplier or inventory data is copied.

do $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_regular_wh uuid;
  v_return_wh uuid;
  v_supplier uuid;
  v_last_unit uuid;
  v_standard uuid;
  v_return_product uuid;
  v_b2c uuid;
  v_b2b_a uuid;
  v_b2b_b uuid;
  v_b2b_c uuid;
  v_cost_center uuid;
  v_expense_category uuid;
  v_purchase_order uuid;
begin
  select id into v_tenant
  from public.tenants
  where environment = 'demo'
  order by created_at
  limit 1;

  if v_tenant is null then
    raise exception 'Demo tenant not found; refusing to seed homologation fixtures';
  end if;

  insert into public.branches
    (tenant_id, name, code, city, state, address, phone, email, is_main, active)
  values
    (v_tenant, '[QA] Matriz Homologação', 'QA-MATRIZ', 'Campina Grande', 'PB',
     'ENDEREÇO FICTÍCIO — NÃO UTILIZAR', '00000000000', 'qa-filial@example.invalid', true, true)
  on conflict (tenant_id, code) do update
    set name = excluded.name, city = excluded.city, state = excluded.state,
        address = excluded.address, phone = excluded.phone, email = excluded.email,
        is_main = true, active = true
  returning id into v_branch;

  insert into public.warehouses
    (tenant_id, branch_id, name, code, is_default, active, inventory_kind, available_for_online)
  values
    (v_tenant, v_branch, '[QA] Estoque Principal', 'QA-REG', true, true, 'regular', true)
  on conflict (tenant_id, code) do update
    set branch_id = excluded.branch_id, name = excluded.name,
        is_default = true, active = true, inventory_kind = 'regular',
        available_for_online = true
  returning id into v_regular_wh;

  insert into public.warehouses
    (tenant_id, branch_id, name, code, is_default, active, inventory_kind, available_for_online)
  values
    (v_tenant, v_branch, '[QA] Devoluções / Quarentena', 'QA-RET', false, true, 'outlet_return', false)
  on conflict (tenant_id, code) do update
    set branch_id = excluded.branch_id, name = excluded.name,
        is_default = false, active = true, inventory_kind = 'outlet_return',
        available_for_online = false
  returning id into v_return_wh;

  insert into public.products
    (tenant_id, sku, name, slug, description, short_description,
     price_b2c, price_b2b, price_b2b_a, price_b2b_b, price_b2b_c,
     stock, min_stock, hide_when_out_of_stock, active, featured, is_new, is_offer,
     weight_kg, height_cm, width_cm, length_cm,
     last_purchase_cost, average_cost, inventory_origin, available_for_online)
  values
    (v_tenant, 'QA-LAST-UNIT', '[QA] Produto Última Unidade',
     'qa-produto-ultima-unidade',
     'Produto totalmente fictício para teste de concorrência da última unidade.',
     'HOMOLOGAÇÃO — NÃO VENDER', 100, 100, 92, 95, 100,
     1, 0, false, true, false, false, false,
     1.0, 10, 10, 10, 60, 60, 'purchased', true),
    (v_tenant, 'QA-STANDARD', '[QA] Produto Estoque Padrão',
     'qa-produto-estoque-padrao',
     'Produto totalmente fictício para compras, PDV, B2B e e-commerce.',
     'HOMOLOGAÇÃO — NÃO VENDER', 200, 200, 184, 190, 200,
     20, 5, false, true, false, false, false,
     2.0, 20, 15, 25, 120, 120, 'purchased', true),
    (v_tenant, 'QA-RETURN', '[QA] Produto Troca e Devolução',
     'qa-produto-troca-devolucao',
     'Produto totalmente fictício para troca, devolução e quarentena.',
     'HOMOLOGAÇÃO — NÃO VENDER', 150, 150, 138, 142.50, 150,
     5, 1, false, true, false, false, false,
     1.5, 15, 15, 20, 90, 90, 'purchased', true)
  on conflict (tenant_id, sku) do update
    set name = excluded.name,
        description = excluded.description,
        short_description = excluded.short_description,
        price_b2c = excluded.price_b2c,
        price_b2b = excluded.price_b2b,
        price_b2b_a = excluded.price_b2b_a,
        price_b2b_b = excluded.price_b2b_b,
        price_b2b_c = excluded.price_b2b_c,
        stock = excluded.stock,
        min_stock = excluded.min_stock,
        active = true,
        weight_kg = excluded.weight_kg,
        height_cm = excluded.height_cm,
        width_cm = excluded.width_cm,
        length_cm = excluded.length_cm,
        last_purchase_cost = excluded.last_purchase_cost,
        average_cost = excluded.average_cost,
        inventory_origin = excluded.inventory_origin,
        available_for_online = true;

  select id into v_last_unit from public.products where tenant_id=v_tenant and sku='QA-LAST-UNIT';
  select id into v_standard from public.products where tenant_id=v_tenant and sku='QA-STANDARD';
  select id into v_return_product from public.products where tenant_id=v_tenant and sku='QA-RETURN';

  insert into public.product_stock
    (tenant_id, product_id, warehouse_id, on_hand, reserved, min_stock)
  values
    (v_tenant, v_last_unit, v_regular_wh, 1, 0, 0),
    (v_tenant, v_standard, v_regular_wh, 20, 0, 5),
    (v_tenant, v_return_product, v_regular_wh, 5, 0, 1)
  on conflict (tenant_id, product_id, warehouse_id) do update
    set on_hand=excluded.on_hand, reserved=0, min_stock=excluded.min_stock, updated_at=now();

  if not exists (
    select 1 from public.stock_movements
    where tenant_id=v_tenant and product_id=v_last_unit and warehouse_id=v_regular_wh
      and reference='QA-SEED-LAST-UNIT'
  ) then
    insert into public.stock_movements
      (tenant_id, product_id, warehouse_id, type, qty, reference, notes)
    values
      (v_tenant, v_last_unit, v_regular_wh, 'IN', 1, 'QA-SEED-LAST-UNIT',
       'HOMOLOGAÇÃO — saldo inicial fictício');
  end if;

  if not exists (
    select 1 from public.stock_movements
    where tenant_id=v_tenant and product_id=v_standard and warehouse_id=v_regular_wh
      and reference='QA-SEED-STANDARD'
  ) then
    insert into public.stock_movements
      (tenant_id, product_id, warehouse_id, type, qty, reference, notes)
    values
      (v_tenant, v_standard, v_regular_wh, 'IN', 20, 'QA-SEED-STANDARD',
       'HOMOLOGAÇÃO — saldo inicial fictício');
  end if;

  if not exists (
    select 1 from public.stock_movements
    where tenant_id=v_tenant and product_id=v_return_product and warehouse_id=v_regular_wh
      and reference='QA-SEED-RETURN'
  ) then
    insert into public.stock_movements
      (tenant_id, product_id, warehouse_id, type, qty, reference, notes)
    values
      (v_tenant, v_return_product, v_regular_wh, 'IN', 5, 'QA-SEED-RETURN',
       'HOMOLOGAÇÃO — saldo inicial fictício');
  end if;

  select id into v_supplier
  from public.suppliers
  where tenant_id=v_tenant and tax_id='99999999000434'
  limit 1;

  if v_supplier is null then
    insert into public.suppliers
      (tenant_id, legal_name, trade_name, tax_id, email, phone, whatsapp,
       address, city, state, zip_code, contact_name, average_lead_days,
       payment_terms, notes, active)
    values
      (v_tenant, '[QA] Fornecedor Fictício Ltda', '[QA] Fornecedor Homologação',
       '99999999000434', 'qa-fornecedor@example.invalid', '00000000000',
       '00000000000', 'ENDEREÇO FICTÍCIO — NÃO UTILIZAR', 'Campina Grande', 'PB',
       '00000000', 'Contato QA', 3, '30/60/90',
       'DADOS FICTÍCIOS PARA HOMOLOGAÇÃO. NÃO UTILIZAR EM OPERAÇÃO REAL.', true)
    returning id into v_supplier;
  end if;

  insert into public.customers
    (tenant_id, name, email, phone, document, customer_group, b2b_status,
     active, source, trade_name, city, state, zip_code, source_payload)
  values
    (v_tenant, '[QA] Cliente Balcão', 'qa-b2c@example.invalid', '00000000000',
     'HOMO-B2C-001', 'b2c', 'none', true, 'erp',
     '[QA] Cliente Balcão', 'Campina Grande', 'PB', '00000000',
     '{"fixture":"homologation"}'::jsonb),
    (v_tenant, '[QA] Revendedor Tabela A', 'qa-b2b-a@example.invalid', '00000000000',
     '99999999000191', 'revendedor', 'approved', true, 'erp',
     '[QA] Revendedor A', 'Campina Grande', 'PB', '00000000',
     '{"fixture":"homologation","price_table":"A"}'::jsonb),
    (v_tenant, '[QA] Oficina Tabela B', 'qa-b2b-b@example.invalid', '00000000000',
     '99999999000272', 'oficina', 'approved', true, 'erp',
     '[QA] Oficina B', 'Campina Grande', 'PB', '00000000',
     '{"fixture":"homologation","price_table":"B"}'::jsonb),
    (v_tenant, '[QA] Distribuidor Tabela C', 'qa-b2b-c@example.invalid', '00000000000',
     '99999999000353', 'distribuidor', 'approved', true, 'erp',
     '[QA] Distribuidor C', 'Campina Grande', 'PB', '00000000',
     '{"fixture":"homologation","price_table":"C"}'::jsonb)
  on conflict (tenant_id, document) do update
    set name=excluded.name, email=excluded.email, phone=excluded.phone,
        customer_group=excluded.customer_group, b2b_status=excluded.b2b_status,
        active=true, source='erp', trade_name=excluded.trade_name,
        city=excluded.city, state=excluded.state, zip_code=excluded.zip_code,
        source_payload=excluded.source_payload;

  select id into v_b2c from public.customers where tenant_id=v_tenant and document='HOMO-B2C-001';
  select id into v_b2b_a from public.customers where tenant_id=v_tenant and document='99999999000191';
  select id into v_b2b_b from public.customers where tenant_id=v_tenant and document='99999999000272';
  select id into v_b2b_c from public.customers where tenant_id=v_tenant and document='99999999000353';

  insert into public.b2b_price_table_settings
    (tenant_id, table_a_discount_pct, table_b_discount_pct, table_c_discount_pct, active)
  values
    (v_tenant, 8, 5, 0, true)
  on conflict (tenant_id) do update
    set table_a_discount_pct=8, table_b_discount_pct=5,
        table_c_discount_pct=0, active=true, updated_at=now();

  insert into public.b2b_customer_price_tables
    (tenant_id, customer_id, cnpj_digits, price_table, active)
  values
    (v_tenant, v_b2b_a, '99999999000191', 'A', true),
    (v_tenant, v_b2b_b, '99999999000272', 'B', true),
    (v_tenant, v_b2b_c, '99999999000353', 'C', true)
  on conflict (tenant_id, customer_id) do update
    set cnpj_digits=excluded.cnpj_digits, price_table=excluded.price_table,
        active=true, updated_at=now();

  insert into public.cost_centers (tenant_id, name, active)
  values (v_tenant, '[QA] Operação Homologação', true)
  on conflict (tenant_id, name) do update set active=true
  returning id into v_cost_center;

  insert into public.expense_categories (tenant_id, name, default_kind, active)
  values (v_tenant, '[QA] Compra / Fornecedor', 'variable', true)
  on conflict (tenant_id, name) do update set default_kind='variable', active=true
  returning id into v_expense_category;

  insert into public.financial_receivables
    (tenant_id, source_type, source_id, customer_id, customer_name, description,
     amount, due_date, payment_method, payment_reference, status, notes)
  values
    (v_tenant, 'manual', '00000000-0000-4000-8000-000000009001'::uuid,
     v_b2c, '[QA] Cliente Balcão', '[QA] Título fictício para teste de baixa',
     250.00, current_date + 15, 'PIX', 'QA-REC-001', 'open',
     'HOMOLOGAÇÃO — dado fictício, não cobrar')
  on conflict (tenant_id, source_type, source_id) do update
    set customer_id=excluded.customer_id, customer_name=excluded.customer_name,
        description=excluded.description, amount=excluded.amount,
        due_date=excluded.due_date, payment_method=excluded.payment_method,
        payment_reference=excluded.payment_reference, status='open',
        received_at=null, notes=excluded.notes, updated_at=now();

  insert into public.purchase_orders
    (tenant_id, number, supplier_id, warehouse_id, status, issued_at, expected_at,
     payment_terms, freight_amount, discount_amount, other_amount,
     items_total, total_amount, notes)
  values
    (v_tenant, 990001, v_supplier, v_regular_wh, 'draft', current_date,
     current_date + 7, '30/60/90', 0, 0, 0, 500, 500,
     'HOMOLOGAÇÃO — pedido fictício QA-PO-990001')
  on conflict (tenant_id, number) do update
    set supplier_id=excluded.supplier_id, warehouse_id=excluded.warehouse_id,
        status='draft', issued_at=excluded.issued_at, expected_at=excluded.expected_at,
        payment_terms=excluded.payment_terms, freight_amount=0, discount_amount=0,
        other_amount=0, items_total=500, total_amount=500,
        notes=excluded.notes, approved_at=null, approved_by=null,
        sent_at=null, cancelled_at=null, cancelled_by=null, cancel_reason=null,
        updated_at=now()
  returning id into v_purchase_order;

  insert into public.purchase_order_items
    (tenant_id, purchase_order_id, product_id, ordered_qty, received_qty,
     unit_cost, discount_amount, tax_amount, line_total, notes)
  values
    (v_tenant, v_purchase_order, v_standard, 10, 0, 50, 0, 0, 500,
     'HOMOLOGAÇÃO — item fictício')
  on conflict (purchase_order_id, product_id) do update
    set ordered_qty=10, received_qty=0, unit_cost=50,
        discount_amount=0, tax_amount=0, line_total=500,
        notes=excluded.notes, updated_at=now();
end
$$;
