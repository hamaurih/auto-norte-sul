alter table public.branches
  add column if not exists available_for_pickup boolean not null default false,
  add column if not exists pickup_instructions text;

alter table public.orders
  add column if not exists fulfillment_type text not null default 'delivery',
  add column if not exists pickup_branch_id uuid references public.branches(id) on delete set null,
  add column if not exists pickup_status text,
  add column if not exists pickup_ready_at timestamptz,
  add column if not exists picked_up_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_fulfillment_type_check'
  ) then
    alter table public.orders
      add constraint orders_fulfillment_type_check
      check (fulfillment_type in ('delivery','pickup'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'orders_pickup_status_check'
  ) then
    alter table public.orders
      add constraint orders_pickup_status_check
      check (pickup_status is null or pickup_status in ('awaiting_preparation','ready','picked_up','cancelled'));
  end if;
end $$;

create index if not exists idx_orders_fulfillment_type
  on public.orders(tenant_id, fulfillment_type, created_at desc);
create index if not exists idx_orders_pickup_branch
  on public.orders(tenant_id, pickup_branch_id)
  where pickup_branch_id is not null;

update public.branches b
set
  available_for_pickup = true,
  address = trim(concat_ws(', ', nullif(cp.address_street,''), nullif(cp.address_number,''), nullif(cp.address_complement,''), nullif(cp.address_neighborhood,''))),
  city = cp.address_city,
  state = cp.address_state,
  phone = coalesce(nullif(cp.whatsapp,''), nullif(cp.phone,''), b.phone),
  pickup_instructions = coalesce(b.pickup_instructions, 'Retire somente após receber a confirmação de que o pedido está pronto.')
from public.tenant_storefronts s
join public.tenant_company_profiles cp on cp.tenant_id = s.tenant_id
where b.tenant_id = s.tenant_id
  and s.slug = 'norte-sul-real'
  and b.code = 'MATRIZ';

update public.branches b
set available_for_pickup = false
where b.code like 'QA-%' or b.name ilike '%homologação%';

create or replace function private.operate_order(
  p_order_id uuid,
  p_next_status public.order_status,
  p_note text,
  p_actor_user_id uuid
)
returns public.order_status
language plpgsql
security definer
set search_path to ''
as $function$
declare
  sale public.orders%rowtype;
  actor_allowed boolean;
begin
  if p_actor_user_id is null then raise exception 'authenticated actor is required'; end if;
  select current_order.* into sale from public.orders current_order where current_order.id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  select exists(
    select 1 from public.tenant_memberships membership
    where membership.tenant_id=sale.tenant_id
      and membership.user_id=p_actor_user_id
      and membership.active
      and membership.role in ('owner','admin','manager','sales','stock')
  ) into actor_allowed;
  if not actor_allowed then raise exception 'order operation is not authorized'; end if;
  if sale.status=p_next_status then return sale.status; end if;
  if p_next_status='faturado'::public.order_status
     and not exists(
       select 1 from public.order_dispatches d
       where d.tenant_id=sale.tenant_id and d.order_id=sale.id and d.status='conferred'
     ) then
    raise exception 'Conferência de saída obrigatória antes de faturar o pedido';
  end if;
  if not (
    (sale.status='pago'::public.order_status and p_next_status='faturado'::public.order_status)
    or (sale.status='faturado'::public.order_status and p_next_status='enviado'::public.order_status and sale.fulfillment_type='delivery')
    or (sale.status='enviado'::public.order_status and p_next_status='entregue'::public.order_status and sale.fulfillment_type='delivery')
    or (sale.status='faturado'::public.order_status and p_next_status='entregue'::public.order_status and sale.fulfillment_type='pickup' and sale.pickup_status='ready')
  ) then
    raise exception 'invalid order transition from % to %',sale.status,p_next_status;
  end if;
  perform set_config('app.order_status_actor',p_actor_user_id::text,true);
  perform set_config('app.order_status_note',left(coalesce(nullif(trim(p_note),''),'Atualização operacional'),500),true);
  update public.orders current_order set status=p_next_status where current_order.id=sale.id;
  return p_next_status;
end
$function$;