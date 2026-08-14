-- Pedidos automáticos por fornecedor + inteligência comercial
begin;

create table if not exists public.product_pricing_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  tax_rate numeric(7,4) not null default 0,
  commission_rate numeric(7,4) not null default 0,
  payment_fee_rate numeric(7,4) not null default 0,
  other_variable_rate numeric(7,4) not null default 0,
  fixed_cost_per_unit numeric(14,4) not null default 0,
  desired_margin_rate numeric(7,4) not null default 0.30,
  price_rounding text not null default 'none'
    check (price_rounding in ('none','x90','x99','whole')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_pricing_settings_product_key unique (tenant_id, product_id),
  constraint product_pricing_settings_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade,
  constraint product_pricing_settings_rates_check check (
    tax_rate between 0 and 0.99
    and commission_rate between 0 and 0.99
    and payment_fee_rate between 0 and 0.99
    and other_variable_rate between 0 and 0.99
    and desired_margin_rate between 0 and 0.99
    and fixed_cost_per_unit >= 0
    and tax_rate + commission_rate + payment_fee_rate + other_variable_rate + desired_margin_rate < 1
  )
);

drop trigger if exists product_pricing_settings_updated_at on public.product_pricing_settings;
create trigger product_pricing_settings_updated_at
before update on public.product_pricing_settings
for each row execute function private.set_updated_at();

alter table public.product_pricing_settings enable row level security;
drop policy if exists product_pricing_settings_select on public.product_pricing_settings;
create policy product_pricing_settings_select
on public.product_pricing_settings for select to authenticated
using ((select private.has_tenant_role(tenant_id, null)));
drop policy if exists product_pricing_settings_write on public.product_pricing_settings;
create policy product_pricing_settings_write
on public.product_pricing_settings for all to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager']::text[])));

grant select, insert, update, delete on public.product_pricing_settings to authenticated;
grant all on public.product_pricing_settings to service_role;
revoke all on public.product_pricing_settings from anon;

create or replace function public.get_commercial_intelligence(
  p_tenant_id uuid,
  p_lookback_days integer default 90
)
returns table (
  product_id uuid,
  sku text,
  product_name text,
  units_sold numeric,
  revenue numeric,
  revenue_share_pct numeric,
  cumulative_revenue_pct numeric,
  abc_class text,
  average_cost numeric,
  current_price numeric,
  gross_profit numeric,
  gross_margin_pct numeric,
  markup_pct numeric,
  tax_rate numeric,
  commission_rate numeric,
  payment_fee_rate numeric,
  other_variable_rate numeric,
  fixed_cost_per_unit numeric,
  desired_margin_rate numeric,
  suggested_price numeric,
  price_gap_pct numeric,
  pricing_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select 1 from public.tenant_memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.active
      and m.role in ('owner','admin','manager')
  ),
  sales as (
    select oi.product_id,
           sum(oi.quantity)::numeric as units,
           sum(oi.total)::numeric as revenue
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.tenant_id = oi.tenant_id
    where oi.tenant_id = p_tenant_id
      and o.status::text in ('pago','faturado','enviado','entregue')
      and o.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_lookback_days,90),365)))
    group by oi.product_id
  ),
  ranked as (
    select p.id,
           p.sku,
           p.name,
           coalesce(s.units,0)::numeric as units,
           coalesce(s.revenue,0)::numeric as revenue,
           coalesce(p.average_cost,p.last_purchase_cost,0)::numeric as cost,
           coalesce(p.sale_price_b2c,p.price_b2c,0)::numeric as price,
           coalesce(ps.tax_rate,0)::numeric as tax,
           coalesce(ps.commission_rate,0)::numeric as commission,
           coalesce(ps.payment_fee_rate,0)::numeric as payment_fee,
           coalesce(ps.other_variable_rate,0)::numeric as other_rate,
           coalesce(ps.fixed_cost_per_unit,0)::numeric as fixed_cost,
           coalesce(ps.desired_margin_rate,0.30)::numeric as desired_margin,
           coalesce(ps.price_rounding,'none') as rounding,
           sum(coalesce(s.revenue,0)) over ()::numeric as total_revenue,
           sum(coalesce(s.revenue,0)) over (
             order by coalesce(s.revenue,0) desc, p.id
             rows between unbounded preceding and current row
           )::numeric as cumulative_revenue
    from public.products p
    cross join allowed
    left join sales s on s.product_id=p.id
    left join public.product_pricing_settings ps
      on ps.tenant_id=p.tenant_id and ps.product_id=p.id
    where p.tenant_id=p_tenant_id and p.active
  ),
  priced as (
    select r.*,
      case when 1-(r.tax+r.commission+r.payment_fee+r.other_rate+r.desired_margin) > 0
        then (r.cost+r.fixed_cost) /
          (1-(r.tax+r.commission+r.payment_fee+r.other_rate+r.desired_margin))
        else null end as raw_suggested
    from ranked r
  ),
  rounded as (
    select p.*,
      case
        when p.raw_suggested is null then null
        when p.rounding='x90' then floor(p.raw_suggested)+0.90
        when p.rounding='x99' then floor(p.raw_suggested)+0.99
        when p.rounding='whole' then ceil(p.raw_suggested)
        else round(p.raw_suggested,2)
      end::numeric as suggested
    from priced p
  )
  select r.id, r.sku, r.name, r.units, round(r.revenue,2),
    case when r.total_revenue>0 then round(r.revenue/r.total_revenue*100,2) else 0 end,
    case when r.total_revenue>0 then round(r.cumulative_revenue/r.total_revenue*100,2) else 0 end,
    case
      when r.total_revenue=0 then 'C'
      when r.cumulative_revenue/r.total_revenue <= 0.80 then 'A'
      when r.cumulative_revenue/r.total_revenue <= 0.95 then 'B'
      else 'C'
    end,
    r.cost, r.price,
    round(r.revenue-(r.units*r.cost),2),
    case when r.revenue>0 then round((r.revenue-(r.units*r.cost))/r.revenue*100,2)
         when r.price>0 then round((r.price-r.cost)/r.price*100,2) else null end,
    case when r.cost>0 and r.price>0 then round((r.price/r.cost-1)*100,2) else null end,
    r.tax, r.commission, r.payment_fee, r.other_rate, r.fixed_cost, r.desired_margin,
    r.suggested,
    case when r.price>0 and r.suggested is not null then round((r.suggested/r.price-1)*100,2) else null end,
    case
      when r.price<=0 then 'sem_preco'
      when r.price<r.cost then 'margem_negativa'
      when r.suggested is not null and r.price<r.suggested*0.95 then 'abaixo_sugerido'
      when r.suggested is not null and r.price>r.suggested*1.30 then 'acima_sugerido'
      else 'adequado'
    end
  from rounded r
  order by r.revenue desc, r.name;
$$;

revoke all on function public.get_commercial_intelligence(uuid,integer) from public;
revoke all on function public.get_commercial_intelligence(uuid,integer) from anon;
grant execute on function public.get_commercial_intelligence(uuid,integer) to authenticated;
grant execute on function public.get_commercial_intelligence(uuid,integer) to service_role;

create or replace function public.create_replenishment_purchase_orders(
  p_tenant_id uuid,
  p_warehouse_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_supplier uuid;
  v_order_id uuid;
  v_order_number integer;
  v_group record;
  v_item record;
  v_orders jsonb:='[]'::jsonb;
  v_total numeric;
  v_lead integer;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  if not exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=v_user and m.active
      and m.role in ('owner','admin','manager','stock')
  ) then raise exception 'Sem permissão para gerar pedidos'; end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id=p_warehouse_id and w.tenant_id=p_tenant_id and w.active
  ) then raise exception 'Depósito inválido'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Selecione ao menos um produto';
  end if;

  for v_group in
    select x.supplier_id, sum(x.qty*x.unit_cost) as total
    from jsonb_to_recordset(p_items) as x(product_id uuid,supplier_id uuid,qty numeric,unit_cost numeric)
    where x.qty>0 and x.supplier_id is not null
    group by x.supplier_id
  loop
    if not exists (
      select 1 from public.suppliers s
      where s.id=v_group.supplier_id and s.tenant_id=p_tenant_id and s.active
    ) then raise exception 'Fornecedor inválido: %',v_group.supplier_id; end if;

    select coalesce(average_lead_days,7) into v_lead
    from public.suppliers where id=v_group.supplier_id and tenant_id=p_tenant_id;

    insert into public.purchase_orders(
      tenant_id,supplier_id,warehouse_id,status,issued_at,expected_at,
      items_total,total_amount,notes,created_by,updated_by
    ) values (
      p_tenant_id,v_group.supplier_id,p_warehouse_id,'draft',current_date,current_date+v_lead,
      round(v_group.total,2),round(v_group.total,2),
      'Gerado pela reposição inteligente',v_user,v_user
    ) returning id,number into v_order_id,v_order_number;

    insert into public.purchase_order_items(
      tenant_id,purchase_order_id,product_id,ordered_qty,unit_cost,line_total
    )
    select p_tenant_id,v_order_id,x.product_id,x.qty,x.unit_cost,round(x.qty*x.unit_cost,2)
    from jsonb_to_recordset(p_items) as x(product_id uuid,supplier_id uuid,qty numeric,unit_cost numeric)
    join public.products p on p.id=x.product_id and p.tenant_id=p_tenant_id and p.active
    where x.supplier_id=v_group.supplier_id and x.qty>0;

    if not found then raise exception 'Fornecedor sem itens válidos'; end if;

    v_orders:=v_orders||jsonb_build_array(jsonb_build_object(
      'id',v_order_id,'number',v_order_number,'supplier_id',v_group.supplier_id,'total',round(v_group.total,2)
    ));
  end loop;

  if jsonb_array_length(v_orders)=0 then
    raise exception 'Todos os produtos precisam de fornecedor preferencial';
  end if;

  return jsonb_build_object('ok',true,'orders',v_orders,'count',jsonb_array_length(v_orders));
end;
$$;

revoke all on function public.create_replenishment_purchase_orders(uuid,uuid,jsonb) from public;
revoke all on function public.create_replenishment_purchase_orders(uuid,uuid,jsonb) from anon;
grant execute on function public.create_replenishment_purchase_orders(uuid,uuid,jsonb) to authenticated;
grant execute on function public.create_replenishment_purchase_orders(uuid,uuid,jsonb) to service_role;

commit;
