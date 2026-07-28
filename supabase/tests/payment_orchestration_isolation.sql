begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '10000000-0000-0000-0000-000000000051',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'pagamento-1c@example.invalid', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.customers (tenant_id, user_id, name, email)
select tenant.id, '10000000-0000-0000-0000-000000000051',
  'Cliente Fase 1C', 'pagamento-1c@example.invalid'
from public.tenants tenant where tenant.environment = 'demo';

insert into public.orders (
  tenant_id, user_id, customer_id, status, subtotal, shipping,
  discount, total, payment_method, customer_name, customer_email,
  idempotency_key
)
select tenant.id, '10000000-0000-0000-0000-000000000051', customer.id,
  'aguardando_pagamento', 150, 0, 0, 150, 'pix',
  customer.name, customer.email,
  '20000000-0000-0000-0000-000000000051'
from public.tenants tenant
join public.customers customer on customer.tenant_id = tenant.id
where tenant.environment = 'demo'
  and customer.email = 'pagamento-1c@example.invalid';

set local role service_role;

do $test$
declare
  selected_order uuid;
  first_intent public.payment_intents;
  repeated_intent public.payment_intents;
begin
  select sale.id into selected_order
  from public.orders sale
  join public.tenants tenant on tenant.id = sale.tenant_id
  where tenant.environment = 'demo'
    and sale.idempotency_key = '20000000-0000-0000-0000-000000000051';

  first_intent := public.internal_create_payment_intent(
    selected_order,
    '10000000-0000-0000-0000-000000000051',
    '30000000-0000-0000-0000-000000000051',
    null
  );
  repeated_intent := public.internal_create_payment_intent(
    selected_order,
    '10000000-0000-0000-0000-000000000051',
    '30000000-0000-0000-0000-000000000051',
    null
  );

  if first_intent.id <> repeated_intent.id then
    raise exception 'payment intent idempotency failed';
  end if;
  if first_intent.amount <> 150 or first_intent.method <> 'pix' then
    raise exception 'payment amount or method was not server-authoritative';
  end if;
  if (
    select provider.code
    from public.payment_providers provider
    where provider.id = first_intent.provider_id
  ) <> 'mock' then
    raise exception 'demo routing did not select mock provider';
  end if;

  update public.payment_intents
  set external_id = 'mock-payment-1', status = 'pending'
  where id = first_intent.id;

  if public.internal_apply_payment_webhook(
    first_intent.provider_id,
    'mock-event-1',
    'payment.updated',
    'mock-payment-1',
    'paid',
    repeat('a', 64),
    true
  ) <> 'processed' then
    raise exception 'verified webhook was not processed';
  end if;

  if public.internal_apply_payment_webhook(
    first_intent.provider_id,
    'mock-event-1',
    'payment.updated',
    'mock-payment-1',
    'paid',
    repeat('a', 64),
    true
  ) <> 'duplicate' then
    raise exception 'webhook idempotency failed';
  end if;

  if (
    select sale.status from public.orders sale where sale.id = selected_order
  ) <> 'pago' then
    raise exception 'paid webhook did not confirm order';
  end if;
end;
$test$;

reset role;

do $test$
begin
  if has_function_privilege(
    'anon',
    'public.internal_create_payment_intent(uuid,uuid,uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.internal_create_payment_intent(uuid,uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'privileged payment RPC is exposed';
  end if;

  if has_function_privilege(
    'anon',
    'public.internal_apply_payment_webhook(uuid,text,text,text,text,text,boolean)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.internal_apply_payment_webhook(uuid,text,text,text,text,text,boolean)',
    'EXECUTE'
  ) then
    raise exception 'privileged webhook RPC is exposed';
  end if;

  if exists (
    select 1 from public.payment_providers provider
    join public.tenants tenant on tenant.id = provider.tenant_id
    where tenant.environment = 'production'
      and provider.active
      and provider.code <> 'mock'
  ) then
    raise exception 'production provider was activated without credentials';
  end if;
end;
$test$;

rollback;
