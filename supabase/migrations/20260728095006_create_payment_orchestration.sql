begin;

create table public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  display_name text not null,
  adapter_key text not null,
  environment text not null check (environment in ('sandbox', 'production')),
  supported_methods text[] not null default '{}',
  capabilities jsonb not null default '{}'::jsonb,
  priority integer not null default 100 check (priority >= 0),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code, environment),
  unique (id, tenant_id)
);

create index payment_providers_routing_idx
  on public.payment_providers (tenant_id, active, priority);

create table private.payment_provider_secrets (
  provider_id uuid primary key,
  tenant_id uuid not null,
  secret_reference text not null,
  webhook_secret_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_provider_secrets_provider_tenant_fkey
    foreign key (provider_id, tenant_id)
    references public.payment_providers(id, tenant_id)
    on delete cascade
);

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  provider_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  method text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null default 'BRL',
  status text not null default 'created'
    check (status in (
      'created', 'pending', 'requires_action', 'authorized',
      'paid', 'failed', 'cancelled', 'expired',
      'partially_refunded', 'refunded'
    )),
  idempotency_key uuid not null,
  external_id text,
  client_reference text,
  checkout_url text,
  pix_copy_paste text,
  pix_qr_code_url text,
  boleto_url text,
  boleto_barcode text,
  expires_at timestamptz,
  authorized_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  failure_code text,
  failure_message text,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_intents_order_tenant_fkey
    foreign key (order_id, tenant_id)
    references public.orders(id, tenant_id)
    on delete restrict,
  constraint payment_intents_provider_tenant_fkey
    foreign key (provider_id, tenant_id)
    references public.payment_providers(id, tenant_id)
    on delete restrict,
  unique (tenant_id, idempotency_key),
  unique (provider_id, external_id),
  unique (id, tenant_id)
);

create index payment_intents_order_idx
  on public.payment_intents (tenant_id, order_id, created_at desc);
create index payment_intents_provider_status_idx
  on public.payment_intents (provider_id, status, updated_at);
create index payment_intents_user_idx
  on public.payment_intents (user_id, created_at desc);

create table private.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  provider_id uuid not null,
  provider_event_id text not null,
  event_type text not null,
  external_payment_id text,
  signature_verified boolean not null,
  payload_sha256 text not null,
  normalized_status text,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_webhook_provider_tenant_fkey
    foreign key (provider_id, tenant_id)
    references public.payment_providers(id, tenant_id)
    on delete restrict,
  unique (provider_id, provider_event_id)
);

create index payment_webhook_events_processing_idx
  on private.payment_webhook_events (processing_status, received_at);
create index payment_provider_secrets_provider_tenant_idx
  on private.payment_provider_secrets (provider_id, tenant_id);
create index payment_webhook_events_provider_tenant_idx
  on private.payment_webhook_events (provider_id, tenant_id);

create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_intent_id uuid not null,
  requested_by uuid references auth.users(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'succeeded', 'failed', 'cancelled')),
  external_id text,
  idempotency_key uuid not null,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_refunds_intent_tenant_fkey
    foreign key (payment_intent_id, tenant_id)
    references public.payment_intents(id, tenant_id)
    on delete restrict,
  unique (tenant_id, idempotency_key)
);

create index payment_refunds_intent_idx
  on public.payment_refunds (tenant_id, payment_intent_id, created_at desc);
create index payment_intents_order_tenant_fk_idx
  on public.payment_intents (order_id, tenant_id);
create index payment_intents_provider_tenant_fk_idx
  on public.payment_intents (provider_id, tenant_id);
create index payment_refunds_intent_tenant_fk_idx
  on public.payment_refunds (payment_intent_id, tenant_id);
create index payment_refunds_requested_by_idx
  on public.payment_refunds (requested_by);

alter table public.payment_providers enable row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_refunds enable row level security;
alter table private.payment_provider_secrets enable row level security;
alter table private.payment_webhook_events enable row level security;

revoke all on table public.payment_providers from public, anon;
revoke all on table public.payment_intents from public, anon;
revoke all on table public.payment_refunds from public, anon;
revoke all on table private.payment_provider_secrets from public, anon, authenticated;
revoke all on table private.payment_webhook_events from public, anon, authenticated;

grant select on table public.payment_providers to authenticated;
grant select on table public.payment_intents to authenticated;
grant select on table public.payment_refunds to authenticated;
grant all on table public.payment_providers to service_role;
grant all on table public.payment_intents to service_role;
grant all on table public.payment_refunds to service_role;
grant all on table private.payment_provider_secrets to service_role;
grant all on table private.payment_webhook_events to service_role;

create policy payment_providers_tenant_staff_read
on public.payment_providers for select to authenticated
using (
  private.has_tenant_role(
    tenant_id,
    array['owner', 'admin', 'manager', 'finance']::text[]
  )
);

create policy payment_intents_owner_or_staff_read
on public.payment_intents for select to authenticated
using (
  user_id = (select auth.uid())
  or private.has_tenant_role(
    tenant_id,
    array['owner', 'admin', 'manager', 'finance', 'sales']::text[]
  )
);

create policy payment_refunds_tenant_staff_read
on public.payment_refunds for select to authenticated
using (
  private.has_tenant_role(
    tenant_id,
    array['owner', 'admin', 'manager', 'finance']::text[]
  )
);

create policy payment_provider_secrets_deny_client_access
on private.payment_provider_secrets for all to authenticated
using (false)
with check (false);

create policy payment_webhook_events_deny_client_access
on private.payment_webhook_events for all to authenticated
using (false)
with check (false);

create or replace function private.create_payment_intent(
  p_order_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_provider_code text default null
)
returns public.payment_intents
language plpgsql
security definer
set search_path = ''
as $function$
declare
  sale public.orders;
  selected_provider public.payment_providers;
  existing_intent public.payment_intents;
  created_intent public.payment_intents;
  is_staff boolean;
begin
  select current_order.* into sale
  from public.orders current_order
  where current_order.id = p_order_id
  for update;

  if sale.id is null then
    raise exception 'order not found';
  end if;

  select exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = sale.tenant_id
      and membership.user_id = p_actor_user_id
      and membership.active
      and membership.role in ('owner', 'admin', 'manager', 'finance', 'sales')
  ) into is_staff;

  if sale.user_id <> p_actor_user_id and not is_staff then
    raise exception 'payment intent is not authorized';
  end if;
  if sale.status <> 'aguardando_pagamento' then
    raise exception 'order is not awaiting payment';
  end if;

  select intent.* into existing_intent
  from public.payment_intents intent
  where intent.tenant_id = sale.tenant_id
    and intent.idempotency_key = p_idempotency_key;
  if existing_intent.id is not null then
    return existing_intent;
  end if;

  select provider.* into selected_provider
  from public.payment_providers provider
  where provider.tenant_id = sale.tenant_id
    and provider.active
    and sale.payment_method = any(provider.supported_methods)
    and (p_provider_code is null or provider.code = p_provider_code)
  order by provider.priority, provider.created_at
  limit 1;

  if selected_provider.id is null then
    raise exception 'no active payment provider supports method %', sale.payment_method;
  end if;

  insert into public.payment_intents (
    tenant_id, order_id, provider_id, user_id, method,
    amount, idempotency_key, client_reference, expires_at
  )
  values (
    sale.tenant_id, sale.id, selected_provider.id, sale.user_id,
    sale.payment_method, sale.total, p_idempotency_key,
    sale.id::text, now() + interval '30 minutes'
  )
  returning * into created_intent;

  return created_intent;
end;
$function$;

revoke all on function private.create_payment_intent(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.create_payment_intent(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.internal_create_payment_intent(
  p_order_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_provider_code text default null
)
returns public.payment_intents
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;
  return private.create_payment_intent(
    p_order_id, p_actor_user_id, p_idempotency_key, p_provider_code
  );
end;
$function$;

revoke all on function public.internal_create_payment_intent(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.internal_create_payment_intent(uuid, uuid, uuid, text)
  to service_role;

create or replace function private.apply_payment_webhook(
  p_provider_id uuid,
  p_provider_event_id text,
  p_event_type text,
  p_external_payment_id text,
  p_normalized_status text,
  p_payload_sha256 text,
  p_signature_verified boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  provider public.payment_providers;
  intent public.payment_intents;
  inserted_event_id uuid;
begin
  if not p_signature_verified then
    raise exception 'webhook signature was not verified';
  end if;
  if p_normalized_status not in (
    'pending', 'requires_action', 'authorized', 'paid',
    'failed', 'cancelled', 'expired',
    'partially_refunded', 'refunded'
  ) then
    raise exception 'unsupported normalized payment status';
  end if;

  select current_provider.* into provider
  from public.payment_providers current_provider
  where current_provider.id = p_provider_id;
  if provider.id is null then
    raise exception 'payment provider not found';
  end if;

  insert into private.payment_webhook_events (
    tenant_id, provider_id, provider_event_id, event_type,
    external_payment_id, signature_verified, payload_sha256,
    normalized_status
  )
  values (
    provider.tenant_id, provider.id, p_provider_event_id, p_event_type,
    p_external_payment_id, true, p_payload_sha256, p_normalized_status
  )
  on conflict (provider_id, provider_event_id) do nothing
  returning id into inserted_event_id;

  if inserted_event_id is null then
    return 'duplicate';
  end if;

  select current_intent.* into intent
  from public.payment_intents current_intent
  where current_intent.provider_id = provider.id
    and current_intent.external_id = p_external_payment_id
  for update;

  if intent.id is null then
    update private.payment_webhook_events event
    set processing_status = 'ignored', processed_at = now(),
        error_message = 'payment intent not found'
    where event.id = inserted_event_id;
    return 'ignored';
  end if;

  update public.payment_intents current_intent
  set
    status = p_normalized_status,
    authorized_at = case
      when p_normalized_status = 'authorized'
        then coalesce(current_intent.authorized_at, now())
      else current_intent.authorized_at
    end,
    paid_at = case
      when p_normalized_status = 'paid'
        then coalesce(current_intent.paid_at, now())
      else current_intent.paid_at
    end,
    cancelled_at = case
      when p_normalized_status in ('cancelled', 'expired')
        then coalesce(current_intent.cancelled_at, now())
      else current_intent.cancelled_at
    end,
    updated_at = now()
  where current_intent.id = intent.id;

  if p_normalized_status = 'paid' then
    perform private.transition_order(intent.order_id, 'confirm_payment', null);
  elsif p_normalized_status in ('cancelled', 'expired')
    and exists (
      select 1 from public.orders sale
      where sale.id = intent.order_id
        and sale.status = 'aguardando_pagamento'
    )
  then
    perform private.transition_order(
      intent.order_id,
      'cancel',
      null
    );
  end if;

  update private.payment_webhook_events event
  set processing_status = 'processed', processed_at = now()
  where event.id = inserted_event_id;

  return 'processed';
exception when others then
  if inserted_event_id is not null then
    update private.payment_webhook_events event
    set processing_status = 'failed', processed_at = now(),
        error_message = left(sqlerrm, 500)
    where event.id = inserted_event_id;
  end if;
  raise;
end;
$function$;

revoke all on function private.apply_payment_webhook(
  uuid, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function private.apply_payment_webhook(
  uuid, text, text, text, text, text, boolean
) to service_role;

create or replace function public.internal_apply_payment_webhook(
  p_provider_id uuid,
  p_provider_event_id text,
  p_event_type text,
  p_external_payment_id text,
  p_normalized_status text,
  p_payload_sha256 text,
  p_signature_verified boolean
)
returns text
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;
  return private.apply_payment_webhook(
    p_provider_id, p_provider_event_id, p_event_type,
    p_external_payment_id, p_normalized_status,
    p_payload_sha256, p_signature_verified
  );
end;
$function$;

revoke all on function public.internal_apply_payment_webhook(
  uuid, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.internal_apply_payment_webhook(
  uuid, text, text, text, text, text, boolean
) to service_role;

insert into public.payment_providers (
  tenant_id, code, display_name, adapter_key, environment,
  supported_methods, capabilities, priority, active
)
select
  tenant.id,
  provider.code,
  provider.display_name,
  provider.adapter_key,
  case when tenant.environment = 'demo' then 'sandbox' else 'production' end,
  provider.methods,
  provider.capabilities,
  provider.priority,
  provider.code = 'mock' and tenant.environment = 'demo'
from public.tenants tenant
cross join (
  values
    ('cielo', 'Cielo', 'cielo-v3', array['pix','cartao']::text[],
      '{"capture":true,"refund":true,"webhook":true,"tokenization":true}'::jsonb, 10),
    ('mercado_pago', 'Mercado Pago', 'mercado-pago-v1', array['pix','cartao','boleto']::text[],
      '{"capture":true,"refund":true,"webhook":true}'::jsonb, 20),
    ('pagbank', 'PagBank', 'pagbank-v4', array['pix','cartao','boleto']::text[],
      '{"capture":true,"refund":true,"webhook":true}'::jsonb, 30),
    ('stone', 'Stone', 'stone-v1', array['pix','cartao']::text[],
      '{"capture":true,"refund":true,"webhook":true}'::jsonb, 40),
    ('rede', 'Rede', 'rede-ecommerce-v1', array['cartao']::text[],
      '{"capture":true,"refund":true,"webhook":true}'::jsonb, 50),
    ('getnet', 'Getnet', 'getnet-v1', array['pix','cartao','boleto']::text[],
      '{"capture":true,"refund":true,"webhook":true}'::jsonb, 60),
    ('stripe', 'Stripe', 'stripe-v1', array['pix','cartao','boleto']::text[],
      '{"capture":true,"refund":true,"webhook":true}'::jsonb, 70),
    ('mock', 'Simulador de pagamento', 'mock-v1', array['pix','cartao','boleto']::text[],
      '{"capture":true,"refund":true,"webhook":true,"simulation":true}'::jsonb, 999)
) as provider(code, display_name, adapter_key, methods, capabilities, priority)
where tenant.environment in ('production', 'demo')
on conflict (tenant_id, code, environment) do nothing;

commit;
