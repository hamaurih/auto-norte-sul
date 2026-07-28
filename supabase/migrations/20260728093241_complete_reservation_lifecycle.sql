begin;

create unique index warehouses_one_active_default_per_tenant
  on public.warehouses(tenant_id)
  where is_default and active;

alter function public.create_storefront_order(jsonb, jsonb, text, uuid)
  set schema private;

revoke all on function private.create_storefront_order(jsonb, jsonb, text, uuid)
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.create_storefront_order(jsonb, jsonb, text, uuid)
  to service_role;

create or replace function public.internal_create_storefront_order(
  p_user_id uuid,
  p_tenant_slug text,
  p_customer jsonb,
  p_items jsonb,
  p_payment_method text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
  perform set_config(
    'request.headers',
    jsonb_build_object('x-tenant-slug', p_tenant_slug)::text,
    true
  );

  return private.create_storefront_order(
    p_customer,
    p_items,
    p_payment_method,
    p_idempotency_key
  );
end;
$function$;

revoke all on function public.internal_create_storefront_order(
  uuid, text, jsonb, jsonb, text, uuid
) from public, anon, authenticated;
grant execute on function public.internal_create_storefront_order(
  uuid, text, jsonb, jsonb, text, uuid
) to service_role;

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

  if p_action = 'confirm_payment' then
    if p_actor_user_id is not null and not is_staff then
      raise exception 'payment confirmation requires staff';
    end if;
    if sale.status = 'pago' then
      return sale.status;
    end if;
    if sale.status <> 'aguardando_pagamento' then
      raise exception 'order cannot be paid from status %', sale.status;
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
        'Baixa automática após confirmação de pagamento',
        p_actor_user_id
      );
    end loop;

    next_status := 'pago';

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
    notes = case
      when p_action = 'expire' then concat_ws(
        E'\n',
        nullif(current_order.notes, ''),
        'Reserva expirada automaticamente em ' || now()::text
      )
      else current_order.notes
    end
  where current_order.id = sale.id;

  return next_status;
end;
$function$;

revoke all on function private.transition_order(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function private.transition_order(uuid, text, uuid)
  to service_role;

create or replace function private.expire_stock_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  expired_order record;
  processed integer := 0;
begin
  for expired_order in
    select distinct reservation.order_id
    from public.stock_reservations reservation
    join public.orders sale
      on sale.id = reservation.order_id
     and sale.tenant_id = reservation.tenant_id
    where reservation.status = 'active'
      and reservation.expires_at <= now()
      and sale.status = 'aguardando_pagamento'
    order by reservation.order_id
  loop
    perform private.transition_order(expired_order.order_id, 'expire', null);
    processed := processed + 1;
  end loop;

  return processed;
end;
$function$;

revoke all on function private.expire_stock_reservations()
  from public, anon, authenticated;
grant execute on function private.expire_stock_reservations()
  to service_role;

create or replace function public.internal_transition_order(
  p_order_id uuid,
  p_action text,
  p_actor_user_id uuid default null
)
returns public.order_status
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;

  return private.transition_order(p_order_id, p_action, p_actor_user_id);
end;
$function$;

revoke all on function public.internal_transition_order(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.internal_transition_order(uuid, text, uuid)
  to service_role;

create extension if not exists pg_cron;

do $cron$
declare existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'expire-auto-deal-stock-reservations'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'expire-auto-deal-stock-reservations',
    '*/5 * * * *',
    'select private.expire_stock_reservations();'
  );
end;
$cron$;

commit;
