-- Harden B2C/B2B commercial separation and credit terms.
-- One storefront account can evolve from B2C -> pending B2B -> approved B2B.
-- Payment terms remain tenant/customer scoped and are enforced server-side.

alter table public.b2b_customer_price_tables
  add column if not exists allowed_boleto_days integer[] not null default array[15],
  add column if not exists allow_invoice boolean not null default false,
  add column if not exists invoice_due_days integer not null default 28,
  add column if not exists max_card_installments integer not null default 6;

alter table public.b2b_customer_price_tables
  drop constraint if exists b2b_customer_price_tables_boleto_days_check,
  drop constraint if exists b2b_customer_price_tables_invoice_days_check,
  drop constraint if exists b2b_customer_price_tables_card_installments_check;

alter table public.b2b_customer_price_tables
  add constraint b2b_customer_price_tables_boleto_days_check
    check (allowed_boleto_days <@ array[15,30,45,60,90,120]::integer[]),
  add constraint b2b_customer_price_tables_invoice_days_check
    check (invoice_due_days between 1 and 120),
  add constraint b2b_customer_price_tables_card_installments_check
    check (max_card_installments between 1 and 6);

-- A B2B application belongs to a storefront tenant, not globally to the user.
alter table public.b2b_registrations
  drop constraint if exists b2b_registrations_user_id_key;
alter table public.b2b_registrations
  drop constraint if exists b2b_registrations_tenant_user_key;
alter table public.b2b_registrations
  add constraint b2b_registrations_tenant_user_key unique (tenant_id, user_id);

-- Two legacy insert triggers were calling the same function twice.
drop trigger if exists on_b2b_registration on public.b2b_registrations;

create or replace function private.create_storefront_order(
  p_customer jsonb,
  p_items jsonb,
  p_payment_method text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  current_tenant_id uuid := private.requested_storefront_tenant_id();
  current_customer_id uuid;
  current_order_id uuid;
  current_warehouse_id uuid;
  current_is_b2b boolean := false;
  current_subtotal numeric := 0;
  current_price_table text := 'C';
  current_b2b_discount_pct numeric := 0;
  current_allow_invoice boolean := false;
  current_invoice_due_days integer := 28;
  item jsonb;
  item_product public.products%rowtype;
  item_stock public.product_stock%rowtype;
  item_quantity integer;
  item_list_price numeric;
  item_specific_price numeric;
  item_unit_price numeric;
  item_discount_pct numeric;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if current_tenant_id is null then
    raise exception 'valid storefront tenant required';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;
  if p_payment_method not in ('pix', 'cartao', 'boleto', 'faturado_b2b') then
    raise exception 'invalid payment method';
  end if;

  select sale.id
  into current_order_id
  from public.orders sale
  where sale.tenant_id = current_tenant_id
    and sale.user_id = current_user_id
    and sale.idempotency_key = p_idempotency_key;
  if current_order_id is not null then
    return current_order_id;
  end if;

  perform 1
  from public.tenants tenant
  where tenant.id = current_tenant_id
    and tenant.status = 'active';
  if not found then
    raise exception 'inactive tenant';
  end if;

  -- B2B entitlement is strictly tenant-scoped.
  select coalesce(
    (
      select customer.customer_group in ('revendedor','oficina','distribuidor')
        and customer.b2b_status = 'approved'
      from public.customers customer
      where customer.tenant_id = current_tenant_id
        and customer.user_id = current_user_id
        and customer.active
      limit 1
    ),
    false
  )
  into current_is_b2b;

  insert into public.customers (
    tenant_id, user_id, name, email, phone, document,
    customer_group, b2b_status
  )
  values (
    current_tenant_id,
    current_user_id,
    nullif(trim(p_customer->>'name'), ''),
    nullif(lower(trim(p_customer->>'email')), ''),
    nullif(trim(p_customer->>'phone'), ''),
    nullif(regexp_replace(p_customer->>'document', '\\D', '', 'g'), ''),
    case when current_is_b2b then
      coalesce(
        (select customer.customer_group
         from public.customers customer
         where customer.tenant_id = current_tenant_id
           and customer.user_id = current_user_id
         limit 1),
        'b2c'
      )
    else 'b2c' end,
    case when current_is_b2b
      then 'approved'::public.b2b_approval_status
      else 'none'::public.b2b_approval_status
    end
  )
  on conflict (tenant_id, user_id)
  do update set
    name = excluded.name,
    email = excluded.email,
    phone = excluded.phone,
    document = excluded.document,
    updated_at = now()
  returning id into current_customer_id;

  if current_is_b2b then
    select
      coalesce(assignment.price_table, 'C'),
      case coalesce(assignment.price_table, 'C')
        when 'A' then coalesce(settings.table_a_discount_pct, 8)
        when 'B' then coalesce(settings.table_b_discount_pct, 5)
        else coalesce(settings.table_c_discount_pct, 0)
      end,
      coalesce(assignment.allow_invoice, false),
      coalesce(assignment.invoice_due_days, 28)
    into current_price_table, current_b2b_discount_pct,
         current_allow_invoice, current_invoice_due_days
    from (select 1) seed
    left join public.b2b_customer_price_tables assignment
      on assignment.tenant_id = current_tenant_id
     and assignment.customer_id = current_customer_id
     and assignment.active
    left join public.b2b_price_table_settings settings
      on settings.tenant_id = current_tenant_id
     and settings.active
    limit 1;
  end if;

  if p_payment_method = 'faturado_b2b'
    and (not coalesce(current_is_b2b, false) or not current_allow_invoice) then
    raise exception 'faturado B2B não autorizado para este cliente';
  end if;

  select warehouse.id
  into current_warehouse_id
  from public.warehouses warehouse
  where warehouse.tenant_id = current_tenant_id
    and warehouse.active
  order by warehouse.is_default desc, warehouse.created_at
  limit 1;
  if current_warehouse_id is null then
    raise exception 'tenant has no active warehouse';
  end if;

  update public.stock_reservations reservation
  set status = 'expired', updated_at = now()
  where reservation.tenant_id = current_tenant_id
    and reservation.status = 'active'
    and reservation.expires_at <= now();

  update public.product_stock stock
  set reserved = greatest(stock.reserved - expired.quantity, 0)
  from (
    select reservation.product_id, reservation.warehouse_id,
      sum(reservation.quantity)::integer quantity
    from public.stock_reservations reservation
    where reservation.tenant_id = current_tenant_id
      and reservation.status = 'expired'
      and reservation.updated_at >= transaction_timestamp()
    group by reservation.product_id, reservation.warehouse_id
  ) expired
  where stock.tenant_id = current_tenant_id
    and stock.product_id = expired.product_id
    and stock.warehouse_id = expired.warehouse_id;

  insert into public.orders (
    tenant_id, customer_id, user_id, idempotency_key,
    status, is_b2b, b2b_price_table, b2b_price_discount_pct,
    subtotal, shipping, discount, total,
    payment_method, payment_due_days,
    customer_name, customer_email, customer_phone,
    customer_document, shipping_zip, shipping_street, shipping_number,
    shipping_complement, shipping_neighborhood, shipping_city,
    shipping_state, notes
  )
  values (
    current_tenant_id, current_customer_id, current_user_id,
    p_idempotency_key, 'aguardando_pagamento', current_is_b2b,
    case when current_is_b2b then current_price_table end,
    case when current_is_b2b then current_b2b_discount_pct else 0 end,
    0, 0, 0, 0, p_payment_method,
    case when p_payment_method='faturado_b2b' then current_invoice_due_days else null end,
    nullif(trim(p_customer->>'name'), ''),
    nullif(lower(trim(p_customer->>'email')), ''),
    nullif(trim(p_customer->>'phone'), ''),
    nullif(trim(p_customer->>'document'), ''),
    nullif(trim(p_customer->>'shipping_zip'), ''),
    nullif(trim(p_customer->>'shipping_street'), ''),
    nullif(trim(p_customer->>'shipping_number'), ''),
    nullif(trim(p_customer->>'shipping_complement'), ''),
    nullif(trim(p_customer->>'shipping_neighborhood'), ''),
    nullif(trim(p_customer->>'shipping_city'), ''),
    upper(nullif(trim(p_customer->>'shipping_state'), '')),
    nullif(trim(p_customer->>'notes'), '')
  )
  returning id into current_order_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_quantity := (item->>'quantity')::integer;
    if item_quantity <= 0 then
      raise exception 'item quantity must be positive';
    end if;

    select product.*
    into item_product
    from public.products product
    where product.id = (item->>'product_id')::uuid
      and product.tenant_id = current_tenant_id
      and product.active
    for share;
    if not found then
      raise exception 'product unavailable';
    end if;

    if current_is_b2b then
      item_list_price := coalesce(
        item_product.price_b2b,
        item_product.sale_price_b2c,
        item_product.price_b2c
      );
      item_specific_price := case current_price_table
        when 'A' then item_product.price_b2b_a
        when 'B' then item_product.price_b2b_b
        else item_product.price_b2b_c
      end;
      if item_specific_price is not null and item_specific_price >= 0 then
        item_unit_price := round(item_specific_price, 2);
        item_discount_pct := case
          when item_list_price > 0
            then round(((item_list_price - item_unit_price) / item_list_price) * 100, 2)
          else 0
        end;
      else
        item_unit_price := round(
          item_list_price * (1 - current_b2b_discount_pct / 100),
          2
        );
        item_discount_pct := current_b2b_discount_pct;
      end if;
    else
      item_list_price := coalesce(item_product.sale_price_b2c, item_product.price_b2c);
      item_unit_price := item_list_price;
      item_discount_pct := 0;
    end if;

    if item_list_price is null or item_list_price < 0
      or item_unit_price is null or item_unit_price < 0 then
      raise exception 'product has no valid price';
    end if;

    insert into public.product_stock (
      tenant_id, product_id, warehouse_id, on_hand, reserved
    )
    values (
      current_tenant_id, item_product.id, current_warehouse_id,
      greatest(coalesce(item_product.stock, 0), 0), 0
    )
    on conflict (tenant_id, product_id, warehouse_id) do nothing;

    select stock.*
    into item_stock
    from public.product_stock stock
    where stock.tenant_id = current_tenant_id
      and stock.product_id = item_product.id
      and stock.warehouse_id = current_warehouse_id
    for update;

    if item_stock.on_hand - item_stock.reserved < item_quantity then
      raise exception 'insufficient stock for product %', item_product.sku;
    end if;

    update public.product_stock
    set reserved = reserved + item_quantity
    where id = item_stock.id;

    insert into public.order_items (
      tenant_id, order_id, product_id, sku, name,
      quantity, list_price, unit_price, price_table,
      price_discount_pct, discount_amount, total
    )
    values (
      current_tenant_id, current_order_id, item_product.id,
      item_product.sku, item_product.name, item_quantity,
      item_list_price,
      item_unit_price,
      case when current_is_b2b then current_price_table end,
      case when current_is_b2b then item_discount_pct else 0 end,
      round((item_list_price - item_unit_price) * item_quantity, 2),
      item_unit_price * item_quantity
    );

    insert into public.stock_reservations (
      tenant_id, order_id, product_id, warehouse_id, quantity
    )
    values (
      current_tenant_id, current_order_id, item_product.id,
      current_warehouse_id, item_quantity
    );

    current_subtotal := current_subtotal + item_unit_price * item_quantity;
  end loop;

  update public.orders
  set subtotal = current_subtotal,
      total = current_subtotal
  where id = current_order_id
    and tenant_id = current_tenant_id;

  return current_order_id;
end;
$function$;

create or replace function private.transition_order(
  p_order_id uuid,
  p_action text,
  p_actor_user_id uuid default null
)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $function$
declare
  sale public.orders%rowtype;
  reservation public.stock_reservations%rowtype;
  next_status public.order_status;
  is_staff boolean;
  invoice_days integer := 28;
begin
  select current_order.* into sale
  from public.orders current_order
  where current_order.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = sale.tenant_id
      and membership.user_id = p_actor_user_id
      and membership.active
      and membership.role = any (
        array['owner', 'admin', 'manager', 'sales', 'cashier', 'finance', 'stock']
      )
  ) into is_staff;

  if p_action in ('confirm_payment','approve_b2b_invoice') then
    if p_action='confirm_payment'
      and p_actor_user_id is not null and not is_staff then
      raise exception 'payment confirmation requires staff';
    end if;

    if p_action='approve_b2b_invoice' then
      if sale.status = 'faturado' then
        return sale.status;
      end if;
      if sale.status <> 'aguardando_pagamento'
        or not sale.is_b2b
        or sale.payment_method <> 'faturado_b2b' then
        raise exception 'order is not eligible for B2B invoicing';
      end if;
      select assignment.invoice_due_days
      into invoice_days
      from public.b2b_customer_price_tables assignment
      where assignment.tenant_id=sale.tenant_id
        and assignment.customer_id=sale.customer_id
        and assignment.active
        and assignment.allow_invoice;
      if not found then
        raise exception 'B2B invoicing is not authorized for this customer';
      end if;
    else
      if sale.status = 'pago' then
        return sale.status;
      end if;
      if sale.status <> 'aguardando_pagamento' then
        raise exception 'order cannot be paid from status %', sale.status;
      end if;
    end if;

    for reservation in
      select current_reservation.*
      from public.stock_reservations current_reservation
      where current_reservation.order_id = sale.id
        and current_reservation.tenant_id = sale.tenant_id
      order by current_reservation.product_id, current_reservation.warehouse_id
      for update
    loop
      if reservation.status <> 'active' then
        raise exception 'order reservation is not active';
      end if;

      update public.product_stock stock
      set
        on_hand = stock.on_hand - reservation.quantity,
        reserved = stock.reserved - reservation.quantity
      where stock.tenant_id = reservation.tenant_id
        and stock.product_id = reservation.product_id
        and stock.warehouse_id = reservation.warehouse_id
        and stock.on_hand >= reservation.quantity
        and stock.reserved >= reservation.quantity;

      if not found then
        raise exception 'stock invariant violation while consuming reservation';
      end if;

      update public.stock_reservations current_reservation
      set status = 'consumed', updated_at = now()
      where current_reservation.id = reservation.id;

      insert into public.stock_movements (
        tenant_id, product_id, warehouse_id, type, qty,
        reference, notes, user_id
      )
      values (
        reservation.tenant_id,
        reservation.product_id,
        reservation.warehouse_id,
        'OUT',
        reservation.quantity,
        'ORDER:' || sale.id::text,
        case
          when p_action='approve_b2b_invoice'
            then 'Baixa automática após aprovação de faturado B2B'
          else 'Baixa automática após confirmação de pagamento'
        end,
        p_actor_user_id
      );
    end loop;

    if p_action='approve_b2b_invoice' then
      next_status := 'faturado';
      insert into public.financial_receivables (
        tenant_id, source_type, source_id, customer_id, customer_name,
        description, amount, due_date, payment_method, status, notes
      )
      values (
        sale.tenant_id, 'b2b_order', sale.id, sale.customer_id, sale.customer_name,
        'Pedido B2B faturado #' || left(sale.id::text,8),
        sale.total, current_date + invoice_days, 'faturado_b2b', 'open',
        'Gerado automaticamente pelo checkout B2B autorizado.'
      )
      on conflict (tenant_id, source_type, source_id)
      do update set
        customer_id=excluded.customer_id,
        customer_name=excluded.customer_name,
        amount=excluded.amount,
        due_date=excluded.due_date,
        payment_method=excluded.payment_method,
        status=case
          when public.financial_receivables.status='received'
            then public.financial_receivables.status
          else 'open'
        end,
        updated_at=now();
    else
      next_status := 'pago';
    end if;

  elsif p_action in ('cancel', 'expire') then
    if p_action = 'cancel'
      and p_actor_user_id is not null
      and p_actor_user_id <> sale.user_id
      and not is_staff
    then
      raise exception 'order cancellation is not authorized';
    end if;
    if sale.status = 'cancelado' then
      return sale.status;
    end if;
    if sale.status <> 'aguardando_pagamento' then
      raise exception 'consumed or fulfilled orders require a return workflow';
    end if;

    for reservation in
      select current_reservation.*
      from public.stock_reservations current_reservation
      where current_reservation.order_id = sale.id
        and current_reservation.tenant_id = sale.tenant_id
        and current_reservation.status = 'active'
      order by current_reservation.product_id, current_reservation.warehouse_id
      for update
    loop
      if p_action = 'expire' and reservation.expires_at > now() then
        raise exception 'reservation has not expired';
      end if;

      update public.product_stock stock
      set reserved = stock.reserved - reservation.quantity
      where stock.tenant_id = reservation.tenant_id
        and stock.product_id = reservation.product_id
        and stock.warehouse_id = reservation.warehouse_id
        and stock.reserved >= reservation.quantity;

      if not found then
        raise exception 'stock invariant violation while releasing reservation';
      end if;

      update public.stock_reservations current_reservation
      set
        status = case when p_action = 'expire' then 'expired' else 'released' end,
        updated_at = now()
      where current_reservation.id = reservation.id;

      insert into public.stock_movements (
        tenant_id, product_id, warehouse_id, type, qty,
        reference, notes, user_id
      )
      values (
        reservation.tenant_id,
        reservation.product_id,
        reservation.warehouse_id,
        'RELEASE',
        reservation.quantity,
        'ORDER:' || sale.id::text,
        case
          when p_action = 'expire' then 'Liberação automática de reserva expirada'
          else 'Liberação de reserva após cancelamento'
        end,
        p_actor_user_id
      );
    end loop;

    next_status := 'cancelado';
  else
    raise exception 'unsupported order action';
  end if;

  update public.orders current_order
  set
    status = next_status,
    payment_due_days = case
      when p_action='approve_b2b_invoice' then invoice_days
      else current_order.payment_due_days
    end,
    notes = case
      when p_action = 'expire' then concat_ws(
        E'\\n',
        nullif(current_order.notes, ''),
        'Reserva expirada automaticamente em ' || now()::text
      )
      else current_order.notes
    end
  where current_order.id = sale.id;

  return next_status;
end;
$function$;

create or replace function private.enqueue_bling_order_sync()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare v_event text;
begin
  if new.user_id is null or new.idempotency_key is null or new.deleted_at is not null then
    return new;
  end if;
  if tg_op='INSERT' then
    v_event:='created';
  elsif old.status is distinct from new.status then
    if new.status::text in ('paid','pago','faturado') then v_event:='paid';
    elsif new.status::text in ('cancelled','cancelado') then v_event:='cancelled';
    else return new;
    end if;
  else
    return new;
  end if;
  insert into public.bling_order_sync_jobs (tenant_id,order_id,event_type,status,scheduled_at)
  values (new.tenant_id,new.id,v_event,'queued',now())
  on conflict (tenant_id,order_id,event_type) do update
  set status=case when public.bling_order_sync_jobs.status='done' then 'done' else 'queued' end,
      scheduled_at=case when public.bling_order_sync_jobs.status='done' then public.bling_order_sync_jobs.scheduled_at else now() end,
      last_error=case when public.bling_order_sync_jobs.status='done' then public.bling_order_sync_jobs.last_error else null end,
      updated_at=now();
  if v_event='created' then
    update public.orders set bling_sync_status='queued',bling_sync_error=null where id=new.id;
  elsif v_event='paid' then
    update public.orders set bling_sync_status='fiscal_pending',bling_sync_error=null where id=new.id;
  elsif v_event='cancelled' then
    update public.orders set bling_sync_status='queued',bling_sync_error=null where id=new.id;
  end if;
  return new;
end;
$function$;
