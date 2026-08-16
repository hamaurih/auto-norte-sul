begin;

create table if not exists public.order_status_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  from_status public.order_status,
  to_status public.order_status not null,
  note text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_status_events_order_tenant_fkey
    foreign key (order_id, tenant_id)
    references public.orders(id, tenant_id)
    on delete cascade,
  constraint order_status_events_note_length
    check (note is null or char_length(note) <= 500)
);

create index if not exists order_status_events_order_idx
  on public.order_status_events (tenant_id, order_id, created_at desc);
create index if not exists order_status_events_actor_idx
  on public.order_status_events (actor_user_id)
  where actor_user_id is not null;

alter table public.order_status_events enable row level security;

revoke all on table public.order_status_events from public, anon;
grant select on table public.order_status_events to authenticated;
grant all on table public.order_status_events to service_role;

drop policy if exists order_status_events_read on public.order_status_events;
create policy order_status_events_read
on public.order_status_events for select to authenticated
using (
  private.has_tenant_role(tenant_id, null::text[])
  or exists (
    select 1
    from public.orders sale
    where sale.id = order_status_events.order_id
      and sale.tenant_id = order_status_events.tenant_id
      and sale.user_id = (select auth.uid())
  )
);

create or replace function private.record_order_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  event_note text;
  event_actor uuid;
begin
  event_note := nullif(current_setting('app.order_status_note', true), '');
  begin
    event_actor := nullif(current_setting('app.order_status_actor', true), '')::uuid;
  exception when invalid_text_representation then
    event_actor := null;
  end;

  insert into public.order_status_events (
    tenant_id, order_id, from_status, to_status, note, actor_user_id
  )
  values (
    new.tenant_id,
    new.id,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status,
    event_note,
    coalesce(event_actor, (select auth.uid()))
  );

  return new;
end;
$function$;

revoke all on function private.record_order_status_event()
  from public, anon, authenticated;

drop trigger if exists order_status_events_capture on public.orders;
drop trigger if exists order_status_events_capture_insert on public.orders;
drop trigger if exists order_status_events_capture_update on public.orders;

create trigger order_status_events_capture_insert
after insert on public.orders
for each row
execute function private.record_order_status_event();

create trigger order_status_events_capture_update
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function private.record_order_status_event();

create or replace function private.operate_order(
  p_order_id uuid,
  p_next_status public.order_status,
  p_note text,
  p_actor_user_id uuid
)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $function$
declare
  sale public.orders%rowtype;
  actor_allowed boolean;
begin
  if p_actor_user_id is null then
    raise exception 'authenticated actor is required';
  end if;

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
      and membership.role in ('owner', 'admin', 'manager', 'sales', 'stock')
  ) into actor_allowed;

  if not actor_allowed then
    raise exception 'order operation is not authorized';
  end if;

  if sale.status = p_next_status then
    return sale.status;
  end if;

  if not (
    (sale.status = 'pago' and p_next_status = 'faturado')
    or (sale.status = 'faturado' and p_next_status = 'enviado')
    or (sale.status = 'enviado' and p_next_status = 'entregue')
  ) then
    raise exception 'invalid order transition from % to %', sale.status, p_next_status;
  end if;

  perform set_config('app.order_status_actor', p_actor_user_id::text, true);
  perform set_config(
    'app.order_status_note',
    left(coalesce(nullif(trim(p_note), ''), 'Atualização operacional'), 500),
    true
  );

  update public.orders current_order
  set status = p_next_status
  where current_order.id = sale.id;

  return p_next_status;
end;
$function$;

revoke all on function private.operate_order(uuid, public.order_status, text, uuid)
  from public, anon, authenticated;
grant execute on function private.operate_order(uuid, public.order_status, text, uuid)
  to service_role;

create or replace function public.internal_operate_order(
  p_order_id uuid,
  p_next_status public.order_status,
  p_note text,
  p_actor_user_id uuid
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

  return private.operate_order(
    p_order_id,
    p_next_status,
    p_note,
    p_actor_user_id
  );
end;
$function$;

revoke all on function public.internal_operate_order(uuid, public.order_status, text, uuid)
  from public, anon, authenticated;
grant execute on function public.internal_operate_order(uuid, public.order_status, text, uuid)
  to service_role;

insert into public.order_status_events (
  tenant_id, order_id, from_status, to_status, note, actor_user_id, created_at
)
select
  sale.tenant_id,
  sale.id,
  null,
  sale.status,
  'Estado inicial importado',
  null,
  sale.created_at
from public.orders sale
where not exists (
  select 1
  from public.order_status_events event
  where event.order_id = sale.id
    and event.tenant_id = sale.tenant_id
);

commit;
