create table if not exists public.bling_webhook_events (
  event_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_name text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','processed','ignored','error')),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.bling_webhook_events enable row level security;
revoke all on public.bling_webhook_events from anon, authenticated;

create or replace function private.refresh_product_stock_cache(p_tenant_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_available integer;
begin
  select coalesce(sum(greatest(ps.on_hand-ps.reserved,0)),0)::integer
    into v_available
  from public.product_stock ps
  join public.warehouses w
    on w.id=ps.warehouse_id and w.tenant_id=ps.tenant_id
  where ps.tenant_id=p_tenant_id
    and ps.product_id=p_product_id
    and w.active=true
    and w.available_for_online=true;

  perform set_config('norte_sul.stock_cache_sync','1',true);
  update public.products set stock=v_available
   where tenant_id=p_tenant_id and id=p_product_id;
  perform set_config('norte_sul.stock_cache_sync','0',true);
end;
$$;

create or replace view public.v_product_stock_available
with (security_invoker = true)
as
select
  p.tenant_id,
  p.id as product_id,
  coalesce(sum(greatest(ps.on_hand-ps.reserved,0)) filter (where w.active and w.available_for_online),0)::integer as available_multi,
  coalesce(sum(ps.on_hand) filter (where w.active and w.available_for_online),0)::integer as on_hand_multi,
  coalesce(sum(ps.reserved) filter (where w.active and w.available_for_online),0)::integer as reserved_multi,
  p.stock as legacy_stock,
  case
    when count(ps.id) filter (where w.active and w.available_for_online) > 0
      then coalesce(sum(greatest(ps.on_hand-ps.reserved,0)) filter (where w.active and w.available_for_online),0)::integer
    else coalesce(p.stock,0)
  end as available_effective,
  (count(ps.id) filter (where w.active and w.available_for_online) > 0) as has_multi_stock
from public.products p
left join public.product_stock ps
  on ps.product_id=p.id and ps.tenant_id=p.tenant_id
left join public.warehouses w
  on w.id=ps.warehouse_id and w.tenant_id=ps.tenant_id
group by p.tenant_id,p.id,p.stock;

grant select on public.v_product_stock_available to anon, authenticated;
