-- Inteligência comercial v2: vendas omnicanal, estoque, giro e fornecedores
begin;

create or replace function public.get_commercial_intelligence_v2(
  p_tenant_id uuid,
  p_lookback_days integer default 90
)
returns jsonb
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
      and m.role in ('owner','admin','manager')
  ),
  period as (
    select greatest(1, least(coalesce(p_lookback_days, 90), 365))::numeric as days
  ),
  sale_lines as (
    select oi.product_id, oi.quantity::numeric as units, oi.total::numeric as revenue, o.created_at as sold_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.tenant_id = oi.tenant_id
    where oi.tenant_id = p_tenant_id
      and o.status::text in ('pago','faturado','enviado','entregue')
      and o.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_lookback_days,90),365)))
    union all
    select psi.product_id, psi.quantity::numeric, psi.line_total::numeric, ps.created_at
    from public.pos_sale_items psi
    join public.pos_sales ps on ps.id = psi.sale_id and ps.tenant_id = psi.tenant_id
    where psi.tenant_id = p_tenant_id
      and ps.status = 'paid'
      and ps.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_lookback_days,90),365)))
  ),
  sales as (
    select product_id, sum(units)::numeric as units, sum(revenue)::numeric as revenue, max(sold_at) as last_sale_at
    from sale_lines
    group by product_id
  ),
  base as (
    select
      p.id,
      p.sku,
      p.name,
      coalesce(s.units,0)::numeric as units,
      coalesce(s.revenue,0)::numeric as revenue,
      s.last_sale_at,
      coalesce(p.average_cost,p.last_purchase_cost,0)::numeric as cost,
      coalesce(p.sale_price_b2c,p.price_b2c,0)::numeric as price,
      greatest(coalesce(vs.available_effective,p.stock,0),0)::numeric as stock_qty,
      coalesce(cfg.lead_time_days,sup.average_lead_days,7)::numeric as lead_days,
      coalesce(cfg.review_period_days,14)::numeric as review_days,
      cfg.preferred_supplier_id as supplier_id,
      coalesce(sup.trade_name,sup.legal_name) as supplier_name,
      coalesce(pset.tax_rate,0)::numeric as tax,
      coalesce(pset.commission_rate,0)::numeric as commission,
      coalesce(pset.payment_fee_rate,0)::numeric as payment_fee,
      coalesce(pset.other_variable_rate,0)::numeric as other_rate,
      coalesce(pset.fixed_cost_per_unit,0)::numeric as fixed_cost,
      coalesce(pset.desired_margin_rate,0.30)::numeric as desired_margin,
      coalesce(pset.price_rounding,'none') as rounding,
      sum(coalesce(s.revenue,0)) over ()::numeric as total_revenue,
      sum(coalesce(s.revenue,0)) over (
        order by coalesce(s.revenue,0) desc, p.id
        rows between unbounded preceding and current row
      )::numeric as cumulative_revenue,
      pr.days
    from public.products p
    cross join allowed
    cross join period pr
    left join sales s on s.product_id = p.id
    left join public.v_product_stock_available vs on vs.product_id = p.id and vs.tenant_id = p.tenant_id
    left join public.inventory_replenishment_settings cfg on cfg.product_id = p.id and cfg.tenant_id = p.tenant_id
    left join public.suppliers sup on sup.id = cfg.preferred_supplier_id and sup.tenant_id = p.tenant_id
    left join public.product_pricing_settings pset on pset.product_id = p.id and pset.tenant_id = p.tenant_id
    where p.tenant_id = p_tenant_id and p.active
  ),
  calculated as (
    select b.*,
      b.units / b.days as avg_daily_units,
      b.stock_qty * b.cost as stock_value,
      case when b.units > 0 then b.stock_qty / (b.units / b.days) else null end as days_cover,
      case when 1-(b.tax+b.commission+b.payment_fee+b.other_rate+b.desired_margin) > 0
        then (b.cost+b.fixed_cost)/(1-(b.tax+b.commission+b.payment_fee+b.other_rate+b.desired_margin))
        else null end as raw_suggested
    from base b
  ),
  enriched as (
    select c.*,
      case
        when c.raw_suggested is null then null
        when c.rounding='x90' then floor(c.raw_suggested)+0.90
        when c.rounding='x99' then floor(c.raw_suggested)+0.99
        when c.rounding='whole' then ceil(c.raw_suggested)
        else round(c.raw_suggested,2)
      end::numeric as suggested,
      case
        when c.stock_qty <= 0 then 'sem_estoque'
        when c.units = 0 then 'sem_giro'
        when c.stock_qty / nullif(c.units/c.days,0) > 180 then 'capital_parado'
        when c.stock_qty / nullif(c.units/c.days,0) > 90 then 'excesso'
        when c.stock_qty / nullif(c.units/c.days,0) < c.lead_days+c.review_days then 'risco_ruptura'
        else 'saudavel'
      end as inventory_status
    from calculated c
  ),
  payload as (
    select jsonb_build_object(
      'product_id', e.id,
      'sku', e.sku,
      'product_name', e.name,
      'units_sold', round(e.units,2),
      'revenue', round(e.revenue,2),
      'revenue_share_pct', case when e.total_revenue>0 then round(e.revenue/e.total_revenue*100,2) else 0 end,
      'cumulative_revenue_pct', case when e.total_revenue>0 then round(e.cumulative_revenue/e.total_revenue*100,2) else 0 end,
      'abc_class', case
        when e.total_revenue=0 then 'C'
        when e.cumulative_revenue/e.total_revenue <= .80 then 'A'
        when e.cumulative_revenue/e.total_revenue <= .95 then 'B'
        else 'C' end,
      'average_cost', round(e.cost,2),
      'current_price', round(e.price,2),
      'gross_profit', round(e.revenue-(e.units*e.cost),2),
      'gross_margin_pct', case when e.revenue>0 then round((e.revenue-(e.units*e.cost))/e.revenue*100,2)
        when e.price>0 then round((e.price-e.cost)/e.price*100,2) else null end,
      'markup_pct', case when e.cost>0 and e.price>0 then round((e.price/e.cost-1)*100,2) else null end,
      'tax_rate', e.tax,
      'commission_rate', e.commission,
      'payment_fee_rate', e.payment_fee,
      'other_variable_rate', e.other_rate,
      'fixed_cost_per_unit', e.fixed_cost,
      'desired_margin_rate', e.desired_margin,
      'price_rounding', e.rounding,
      'suggested_price', e.suggested,
      'price_gap_pct', case when e.price>0 and e.suggested is not null then round((e.suggested/e.price-1)*100,2) else null end,
      'pricing_status', case
        when e.price<=0 then 'sem_preco'
        when e.price<e.cost then 'margem_negativa'
        when e.suggested is not null and e.price<e.suggested*.95 then 'abaixo_sugerido'
        when e.suggested is not null and e.price>e.suggested*1.30 then 'acima_sugerido'
        else 'adequado' end,
      'stock_qty', round(e.stock_qty,2),
      'stock_value', round(e.stock_value,2),
      'avg_daily_units', round(e.avg_daily_units,3),
      'days_cover', case when e.days_cover is null then null else round(e.days_cover,1) end,
      'last_sale_at', e.last_sale_at,
      'no_sale_days', case when e.last_sale_at is null then null else extract(day from now()-e.last_sale_at)::integer end,
      'inventory_status', e.inventory_status,
      'capital_at_risk', case when e.inventory_status in ('sem_giro','capital_parado','excesso') then round(e.stock_value,2) else 0 end,
      'supplier_id', e.supplier_id,
      'supplier_name', e.supplier_name,
      'lead_time_days', e.lead_days
    ) as item,
    e.revenue,
    e.name
    from enriched e
  )
  select coalesce(jsonb_agg(item order by revenue desc, name), '[]'::jsonb) from payload;
$$;

revoke all on function public.get_commercial_intelligence_v2(uuid,integer) from public;
revoke all on function public.get_commercial_intelligence_v2(uuid,integer) from anon;
grant execute on function public.get_commercial_intelligence_v2(uuid,integer) to authenticated;
grant execute on function public.get_commercial_intelligence_v2(uuid,integer) to service_role;

create or replace function public.get_supplier_performance(
  p_tenant_id uuid,
  p_lookback_days integer default 180
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select 1 from public.tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=auth.uid() and m.active
      and m.role in ('owner','admin','manager')
  ),
  receipts as (
    select
      gr.supplier_id,
      gr.id as receipt_id,
      gr.received_at,
      po.expected_at,
      sum(gri.accepted_qty)::numeric as accepted_qty,
      sum(gri.rejected_qty)::numeric as rejected_qty,
      sum(gri.accepted_qty*gri.unit_cost)::numeric as purchased_value
    from public.goods_receipts gr
    join public.goods_receipt_items gri on gri.goods_receipt_id=gr.id and gri.tenant_id=gr.tenant_id
    left join public.purchase_orders po on po.id=gr.purchase_order_id and po.tenant_id=gr.tenant_id
    cross join allowed
    where gr.tenant_id=p_tenant_id
      and gr.status='confirmed'
      and gr.received_at >= current_date-greatest(1,least(coalesce(p_lookback_days,180),365))
    group by gr.supplier_id,gr.id,gr.received_at,po.expected_at
  ),
  ranked as (
    select
      s.id,
      coalesce(s.trade_name,s.legal_name) as name,
      s.average_lead_days,
      count(r.receipt_id)::integer as receipt_count,
      coalesce(sum(r.purchased_value),0)::numeric as purchased_value,
      coalesce(sum(r.accepted_qty),0)::numeric as accepted_qty,
      coalesce(sum(r.rejected_qty),0)::numeric as rejected_qty,
      count(*) filter (where r.expected_at is not null)::integer as measured_deliveries,
      count(*) filter (where r.expected_at is not null and r.received_at<=r.expected_at)::integer as on_time_deliveries
    from public.suppliers s
    cross join allowed
    left join receipts r on r.supplier_id=s.id
    where s.tenant_id=p_tenant_id and s.active
    group by s.id,s.trade_name,s.legal_name,s.average_lead_days
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'supplier_id',id,
    'supplier_name',name,
    'average_lead_days',average_lead_days,
    'receipt_count',receipt_count,
    'purchased_value',round(purchased_value,2),
    'accepted_qty',round(accepted_qty,2),
    'rejected_qty',round(rejected_qty,2),
    'rejection_rate_pct',case when accepted_qty+rejected_qty>0 then round(rejected_qty/(accepted_qty+rejected_qty)*100,2) else null end,
    'on_time_rate_pct',case when measured_deliveries>0 then round(on_time_deliveries::numeric/measured_deliveries*100,2) else null end,
    'performance_score',round(
      (case when measured_deliveries>0 then on_time_deliveries::numeric/measured_deliveries else .5 end)*70+
      (case when accepted_qty+rejected_qty>0 then 1-rejected_qty/(accepted_qty+rejected_qty) else .5 end)*30
    ,1)
  ) order by purchased_value desc,name),'[]'::jsonb)
  from ranked;
$$;

revoke all on function public.get_supplier_performance(uuid,integer) from public;
revoke all on function public.get_supplier_performance(uuid,integer) from anon;
grant execute on function public.get_supplier_performance(uuid,integer) to authenticated;
grant execute on function public.get_supplier_performance(uuid,integer) to service_role;

commit;
