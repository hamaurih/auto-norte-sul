-- Reposição inteligente de estoque (DEV)
begin;

create table if not exists public.inventory_replenishment_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  preferred_supplier_id uuid,
  max_stock numeric(14,4),
  safety_stock numeric(14,4) not null default 0,
  lead_time_days integer,
  review_period_days integer not null default 14,
  enabled boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_replenishment_settings_product_key unique (tenant_id, product_id),
  constraint inventory_replenishment_settings_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade,
  constraint inventory_replenishment_settings_supplier_tenant_fkey
    foreign key (preferred_supplier_id, tenant_id) references public.suppliers(id, tenant_id),
  constraint inventory_replenishment_settings_values_check check (
    coalesce(max_stock, 0) >= 0 and safety_stock >= 0
    and coalesce(lead_time_days, 0) >= 0
    and review_period_days between 1 and 365
  )
);

create index if not exists inventory_replenishment_supplier_idx
  on public.inventory_replenishment_settings(tenant_id, preferred_supplier_id)
  where preferred_supplier_id is not null;

drop trigger if exists inventory_replenishment_settings_updated_at
  on public.inventory_replenishment_settings;
create trigger inventory_replenishment_settings_updated_at
before update on public.inventory_replenishment_settings
for each row execute function private.set_updated_at();

alter table public.inventory_replenishment_settings enable row level security;

drop policy if exists inventory_replenishment_settings_select on public.inventory_replenishment_settings;
create policy inventory_replenishment_settings_select
on public.inventory_replenishment_settings for select to authenticated
using ((select private.has_tenant_role(tenant_id, null)));

drop policy if exists inventory_replenishment_settings_write on public.inventory_replenishment_settings;
create policy inventory_replenishment_settings_write
on public.inventory_replenishment_settings for all to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[])));

grant select, insert, update, delete on public.inventory_replenishment_settings to authenticated;
grant all on public.inventory_replenishment_settings to service_role;
revoke all on public.inventory_replenishment_settings from anon;

create or replace function public.get_replenishment_suggestions(
  p_tenant_id uuid,
  p_lookback_days integer default 90
)
returns table (
  product_id uuid,
  sku text,
  product_name text,
  internal_code text,
  manufacturer_code text,
  available_qty numeric,
  on_hand_qty numeric,
  reserved_qty numeric,
  pending_purchase_qty numeric,
  units_sold numeric,
  avg_daily_demand numeric,
  lead_time_days integer,
  safety_stock numeric,
  reorder_point numeric,
  target_stock numeric,
  suggested_qty numeric,
  days_of_cover numeric,
  risk_status text,
  preferred_supplier_id uuid,
  preferred_supplier_name text,
  average_cost numeric,
  estimated_purchase_value numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select 1
    from public.tenant_memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.active
      and m.role in ('owner','admin','manager','stock')
  ),
  stock as (
    select ps.product_id,
           sum(ps.on_hand)::numeric as on_hand,
           sum(ps.reserved)::numeric as reserved
    from public.product_stock ps
    where ps.tenant_id = p_tenant_id
    group by ps.product_id
  ),
  sales as (
    select oi.product_id, sum(oi.quantity)::numeric as units_sold
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.tenant_id = oi.tenant_id
    where oi.tenant_id = p_tenant_id
      and o.status::text in ('pago','faturado','enviado','entregue')
      and o.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_lookback_days, 90), 365)))
    group by oi.product_id
  ),
  pending as (
    select poi.product_id,
           sum(greatest(poi.ordered_qty - poi.received_qty, 0))::numeric as pending_qty
    from public.purchase_order_items poi
    join public.purchase_orders po
      on po.id = poi.purchase_order_id and po.tenant_id = poi.tenant_id
    where poi.tenant_id = p_tenant_id
      and po.status in ('approved','sent','partially_received')
    group by poi.product_id
  ),
  base as (
    select p.id,
           p.sku,
           p.name,
           p.internal_code,
           p.manufacturer_code,
           greatest(coalesce(s.on_hand, p.stock, 0), 0)::numeric as on_hand,
           greatest(coalesce(s.reserved, 0), 0)::numeric as reserved,
           greatest(coalesce(s.on_hand, p.stock, 0) - coalesce(s.reserved, 0), 0)::numeric as available,
           greatest(coalesce(pe.pending_qty, 0), 0)::numeric as pending_qty,
           greatest(coalesce(sa.units_sold, 0), 0)::numeric as units_sold,
           greatest(coalesce(p_lookback_days, 90), 1) as lookback_days,
           coalesce(rs.lead_time_days, sup.average_lead_days, 7) as lead_days,
           greatest(coalesce(rs.safety_stock, p.min_stock, 0), 0)::numeric as safety,
           greatest(coalesce(rs.review_period_days, 14), 1) as review_days,
           rs.max_stock,
           rs.preferred_supplier_id,
           sup.legal_name as supplier_name,
           coalesce(p.average_cost, p.last_purchase_cost, 0)::numeric as avg_cost
    from public.products p
    cross join allowed
    left join stock s on s.product_id = p.id
    left join sales sa on sa.product_id = p.id
    left join pending pe on pe.product_id = p.id
    left join public.inventory_replenishment_settings rs
      on rs.tenant_id = p.tenant_id and rs.product_id = p.id
    left join public.suppliers sup
      on sup.tenant_id = p.tenant_id and sup.id = rs.preferred_supplier_id
    where p.tenant_id = p_tenant_id
      and p.active
      and coalesce(rs.enabled, true)
  ),
  calc as (
    select b.*,
           round(b.units_sold / b.lookback_days, 4) as daily_demand,
           greatest(b.safety, ceil((b.units_sold / b.lookback_days) * b.lead_days) + b.safety) as reorder_at,
           greatest(
             coalesce(b.max_stock, 0),
             ceil((b.units_sold / b.lookback_days) * (b.lead_days + b.review_days)) + b.safety
           ) as target
    from base b
  )
  select c.id,
         c.sku,
         c.name,
         c.internal_code,
         c.manufacturer_code,
         c.available,
         c.on_hand,
         c.reserved,
         c.pending_qty,
         c.units_sold,
         c.daily_demand,
         c.lead_days,
         c.safety,
         c.reorder_at,
         c.target,
         greatest(ceil(c.target - c.available - c.pending_qty), 0)::numeric as suggested,
         case when c.daily_demand > 0 then round(c.available / c.daily_demand, 1) else null end,
         case
           when c.available <= 0 and c.daily_demand > 0 then 'ruptura'
           when c.available + c.pending_qty <= c.reorder_at then 'comprar'
           when c.daily_demand = 0 and c.available > greatest(c.target, c.safety) then 'excesso'
           when c.daily_demand > 0 and c.available / c.daily_demand > 120 then 'excesso'
           else 'saudavel'
         end,
         c.preferred_supplier_id,
         c.supplier_name,
         c.avg_cost,
         round(greatest(ceil(c.target - c.available - c.pending_qty), 0) * c.avg_cost, 2)
  from calc c
  order by
    case
      when c.available <= 0 and c.daily_demand > 0 then 0
      when c.available + c.pending_qty <= c.reorder_at then 1
      when c.daily_demand = 0 and c.available > greatest(c.target, c.safety) then 2
      when c.daily_demand > 0 and c.available / c.daily_demand > 120 then 2
      else 3
    end,
    greatest(ceil(c.target - c.available - c.pending_qty), 0) desc,
    c.name;
$$;

revoke all on function public.get_replenishment_suggestions(uuid, integer) from public;
revoke all on function public.get_replenishment_suggestions(uuid, integer) from anon;
grant execute on function public.get_replenishment_suggestions(uuid, integer) to authenticated;
grant execute on function public.get_replenishment_suggestions(uuid, integer) to service_role;

commit;
