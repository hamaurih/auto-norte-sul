-- P0.5 PDV: desconto por limite do vendedor, cliente tenant-safe e pagamentos auditáveis.
-- A função pública permanece um wrapper SECURITY INVOKER; a implementação privilegiada fica em private.

create or replace function private.finalize_pos_sale(
  p_tenant_id uuid,
  p_cash_session_id uuid,
  p_idempotency_key uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount_amount numeric default 0,
  p_customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_session public.pos_cash_sessions;
  v_item jsonb;
  v_payment jsonb;
  v_sale_id uuid;
  v_stock public.product_stock;
  v_product public.products;
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2);
  v_paid numeric(14,2) := 0;
  v_price numeric(14,2);
  v_qty integer;
  v_available integer;
  v_role text;
  v_max_discount_pct numeric := 0;
  v_discount_pct numeric := 0;
  v_method text;
  v_provider_reference text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if pg_catalog.jsonb_typeof(p_items) <> 'array' or pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_SALE';
  end if;
  if pg_catalog.jsonb_typeof(p_payments) <> 'array' or pg_catalog.jsonb_array_length(p_payments) = 0 then
    raise exception 'PAYMENT_REQUIRED';
  end if;
  if coalesce(p_discount_amount, 0) < 0 then raise exception 'INVALID_DISCOUNT'; end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) i
    group by i->>'product_id'
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_PRODUCT';
  end if;

  select *
    into v_session
  from public.pos_cash_sessions
  where id = p_cash_session_id
    and tenant_id = p_tenant_id
    and status = 'open'
  for update;

  if not found then raise exception 'CASH_SESSION_NOT_OPEN'; end if;

  select tm.role
    into v_role
  from public.tenant_memberships tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = v_user
    and tm.active
    and tm.role in ('owner','admin','manager','cashier','sales')
  order by case tm.role
    when 'owner' then 1
    when 'admin' then 2
    when 'manager' then 3
    when 'sales' then 4
    when 'cashier' then 5
    else 99
  end
  limit 1;

  if v_role is null then raise exception 'FORBIDDEN'; end if;

  if v_session.operator_id <> v_user
    and v_role not in ('owner','admin','manager') then
    raise exception 'SESSION_OWNED_BY_ANOTHER_OPERATOR';
  end if;

  if p_customer_id is not null and not exists (
    select 1
    from public.customers c
    where c.id = p_customer_id
      and c.tenant_id = p_tenant_id
      and c.active
  ) then
    raise exception 'INVALID_CUSTOMER';
  end if;

  select id
    into v_sale_id
  from public.pos_sales
  where tenant_id = p_tenant_id
    and idempotency_key = p_idempotency_key;

  if found then return v_sale_id; end if;

  for v_item in
    select * from pg_catalog.jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty <= 0 then raise exception 'INVALID_ITEM'; end if;

    select *
      into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid
      and tenant_id = p_tenant_id
      and active
      and deleted_at is null
    for share;

    if not found then
      raise exception 'PRODUCT_UNAVAILABLE:%', v_item->>'product_id';
    end if;

    v_price := pg_catalog.round(
      coalesce(nullif(v_product.sale_price_b2c, 0), v_product.price_b2c),
      2
    );

    if v_price is null or v_price <= 0 then
      raise exception 'INVALID_PRODUCT_PRICE';
    end if;

    select *
      into v_stock
    from public.product_stock
    where tenant_id = p_tenant_id
      and warehouse_id = v_session.warehouse_id
      and product_id = v_product.id
    for update;

    v_available := coalesce(v_stock.on_hand, 0) - coalesce(v_stock.reserved, 0);
    if not found or v_available < v_qty then
      raise exception 'INSUFFICIENT_STOCK:%', v_product.id;
    end if;

    v_subtotal := v_subtotal + (v_qty * v_price);
  end loop;

  v_total := pg_catalog.round(v_subtotal - coalesce(p_discount_amount, 0), 2);
  if v_total < 0 then raise exception 'INVALID_DISCOUNT'; end if;

  if coalesce(p_discount_amount, 0) > 0 then
    v_discount_pct := case
      when v_subtotal > 0 then (p_discount_amount / v_subtotal) * 100
      else 100
    end;

    if v_role not in ('owner','admin','manager') then
      select coalesce(sr.max_discount_pct, 0)
        into v_max_discount_pct
      from public.sales_reps sr
      where sr.tenant_id = p_tenant_id
        and sr.user_id = v_user
        and sr.active
      limit 1;

      v_max_discount_pct := coalesce(v_max_discount_pct, 0);

      if v_discount_pct > v_max_discount_pct + 0.0001 then
        raise exception 'DISCOUNT_LIMIT_EXCEEDED:%', pg_catalog.round(v_max_discount_pct, 2);
      end if;
    end if;
  end if;

  for v_payment in
    select * from pg_catalog.jsonb_array_elements(p_payments)
  loop
    v_method := v_payment->>'method';
    v_provider_reference := nullif(pg_catalog.btrim(coalesce(v_payment->>'provider_reference', '')), '');

    if v_method not in ('cash','pix','debit_card','credit_card','store_credit','b2b_invoice') then
      raise exception 'INVALID_PAYMENT_METHOD';
    end if;

    if (v_payment->>'amount')::numeric <= 0 then
      raise exception 'INVALID_PAYMENT';
    end if;

    if v_method in ('pix','debit_card','credit_card') and v_provider_reference is null then
      raise exception 'PAYMENT_REFERENCE_REQUIRED:%', v_method;
    end if;

    v_paid := v_paid + pg_catalog.round((v_payment->>'amount')::numeric, 2);
  end loop;

  if v_paid <> v_total then raise exception 'PAYMENT_TOTAL_MISMATCH'; end if;

  insert into public.pos_sales (
    tenant_id,
    cash_session_id,
    warehouse_id,
    operator_id,
    customer_id,
    subtotal,
    discount_amount,
    total,
    idempotency_key
  )
  values (
    p_tenant_id,
    p_cash_session_id,
    v_session.warehouse_id,
    v_user,
    p_customer_id,
    v_subtotal,
    coalesce(p_discount_amount, 0),
    v_total,
    p_idempotency_key
  )
  returning id into v_sale_id;

  for v_item in
    select * from pg_catalog.jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;

    select *
      into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid
      and tenant_id = p_tenant_id;

    v_price := pg_catalog.round(
      coalesce(nullif(v_product.sale_price_b2c, 0), v_product.price_b2c),
      2
    );

    update public.product_stock
    set on_hand = on_hand - v_qty,
        updated_at = pg_catalog.now()
    where tenant_id = p_tenant_id
      and warehouse_id = v_session.warehouse_id
      and product_id = v_product.id;

    insert into public.pos_sale_items (
      tenant_id,
      sale_id,
      product_id,
      quantity,
      unit_price,
      line_total
    )
    values (
      p_tenant_id,
      v_sale_id,
      v_product.id,
      v_qty,
      v_price,
      v_qty * v_price
    );

    insert into public.stock_movements (
      tenant_id,
      product_id,
      warehouse_id,
      type,
      qty,
      reference,
      notes,
      user_id
    )
    values (
      p_tenant_id,
      v_product.id,
      v_session.warehouse_id,
      'OUT',
      v_qty,
      'PDV-' || v_sale_id::text,
      'Venda PDV',
      v_user
    );
  end loop;

  for v_payment in
    select * from pg_catalog.jsonb_array_elements(p_payments)
  loop
    insert into public.pos_payments (
      tenant_id,
      sale_id,
      method,
      amount,
      installments,
      provider,
      provider_reference,
      status
    )
    values (
      p_tenant_id,
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::numeric,
      coalesce((v_payment->>'installments')::integer, 1),
      nullif(v_payment->>'provider', ''),
      nullif(v_payment->>'provider_reference', ''),
      'confirmed'
    );
  end loop;

  return v_sale_id;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_SALE_PAYLOAD';
end
$function$;

comment on function private.finalize_pos_sale(uuid, uuid, uuid, jsonb, jsonb, numeric, uuid)
is 'Finaliza venda PDV com estoque transacional, idempotência, limite de desconto por operador, cliente tenant-safe e referência obrigatória para pagamento eletrônico.';
