-- Norte Sul ERP - Custos, formação de preço, despesas e rentabilidade.
-- Estrutura aditiva: preserva o motor B2B -> B2C existente e adiciona margem real.

alter table public.tenant_pricing_settings
  add column if not exists default_target_margin_pct numeric(7,2) not null default 20
    check (default_target_margin_pct between 0 and 95),
  add column if not exists default_min_margin_pct numeric(7,2) not null default 10
    check (default_min_margin_pct between -100 and 95),
  add column if not exists default_sales_channel_id uuid;

create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default true,
  is_default boolean not null default false,
  tax_pct numeric(7,4) not null default 0 check (tax_pct between 0 and 100),
  payment_fee_pct numeric(7,4) not null default 0 check (payment_fee_pct between 0 and 100),
  sales_commission_pct numeric(7,4) not null default 0 check (sales_commission_pct between 0 and 100),
  marketplace_fee_pct numeric(7,4) not null default 0 check (marketplace_fee_pct between 0 and 100),
  freight_subsidy_pct numeric(7,4) not null default 0 check (freight_subsidy_pct between 0 and 100),
  anticipation_pct numeric(7,4) not null default 0 check (anticipation_pct between 0 and 100),
  expected_loss_pct numeric(7,4) not null default 0 check (expected_loss_pct between 0 and 100),
  other_variable_pct numeric(7,4) not null default 0 check (other_variable_pct between 0 and 100),
  fixed_fee_per_sale numeric(14,4) not null default 0 check (fixed_fee_per_sale >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (id, tenant_id)
);

create unique index if not exists sales_channels_one_default_per_tenant_idx
  on public.sales_channels(tenant_id)
  where is_default and active;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_pricing_settings_default_sales_channel_fk'
      and conrelid = 'public.tenant_pricing_settings'::regclass
  ) then
    alter table public.tenant_pricing_settings
      add constraint tenant_pricing_settings_default_sales_channel_fk
      foreign key (default_sales_channel_id, tenant_id)
      references public.sales_channels(id, tenant_id)
      on delete set null;
  end if;
end $$;

create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)
);

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  default_kind text not null default 'fixed' check (default_kind in ('fixed','variable')),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid,
  cost_center_id uuid,
  description text not null,
  kind text not null default 'fixed' check (kind in ('fixed','variable')),
  status text not null default 'planned' check (status in ('planned','paid','canceled')),
  amount numeric(14,2) not null check (amount >= 0),
  competence_date date not null default current_date,
  due_date date,
  paid_at timestamptz,
  supplier_name text,
  document_number text,
  notes text,
  recurring boolean not null default false,
  recurrence text check (recurrence is null or recurrence in ('weekly','monthly','quarterly','yearly')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, tenant_id) references public.expense_categories(id, tenant_id) on delete set null,
  foreign key (cost_center_id, tenant_id) references public.cost_centers(id, tenant_id) on delete set null
);

create index if not exists expenses_tenant_competence_idx on public.expenses(tenant_id, competence_date desc);
create index if not exists expenses_tenant_status_idx on public.expenses(tenant_id, status);
create index if not exists expenses_tenant_kind_idx on public.expenses(tenant_id, kind);

create table if not exists public.product_profitability_rules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  cost_basis text not null default 'auto' check (cost_basis in ('auto','average','last','replacement','manual')),
  replacement_cost numeric(14,4) check (replacement_cost is null or replacement_cost >= 0),
  manual_cost numeric(14,4) check (manual_cost is null or manual_cost >= 0),
  inbound_freight_value numeric(14,4) not null default 0 check (inbound_freight_value >= 0),
  packaging_cost numeric(14,4) not null default 0 check (packaging_cost >= 0),
  other_unit_cost numeric(14,4) not null default 0 check (other_unit_cost >= 0),
  inventory_loss_pct numeric(7,4) not null default 0 check (inventory_loss_pct between 0 and 100),
  target_margin_pct numeric(7,2) check (target_margin_pct is null or target_margin_pct between 0 and 95),
  min_margin_pct numeric(7,2) check (min_margin_pct is null or min_margin_pct between -100 and 95),
  preferred_channel_id uuid,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, product_id),
  foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade,
  foreign key (preferred_channel_id, tenant_id) references public.sales_channels(id, tenant_id) on delete set null
);

create index if not exists product_profitability_rules_channel_idx
  on public.product_profitability_rules(tenant_id, preferred_channel_id);

alter table public.orders
  add column if not exists sales_channel_id uuid,
  add column if not exists channel_variable_cost_pct_snapshot numeric(8,4),
  add column if not exists channel_fixed_fee_snapshot numeric(14,4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_sales_channel_tenant_fk'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_sales_channel_tenant_fk
      foreign key (sales_channel_id, tenant_id)
      references public.sales_channels(id, tenant_id)
      on delete set null;
  end if;
end $$;

alter table public.order_items
  add column if not exists unit_cost_snapshot numeric(14,4),
  add column if not exists contribution_margin_amount numeric(14,4),
  add column if not exists contribution_margin_pct numeric(8,4);

alter table public.sales_channels enable row level security;
alter table public.cost_centers enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.product_profitability_rules enable row level security;

revoke all on public.sales_channels, public.cost_centers, public.expense_categories, public.expenses, public.product_profitability_rules from anon, authenticated;
grant select, insert, update, delete on public.sales_channels, public.cost_centers, public.expense_categories, public.expenses, public.product_profitability_rules to authenticated;
grant all on public.sales_channels, public.cost_centers, public.expense_categories, public.expenses, public.product_profitability_rules to service_role;

drop policy if exists sales_channels_read on public.sales_channels;
create policy sales_channels_read on public.sales_channels for select to authenticated
using (private.has_tenant_role(tenant_id));
drop policy if exists sales_channels_write on public.sales_channels;
create policy sales_channels_write on public.sales_channels for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

drop policy if exists cost_centers_read on public.cost_centers;
create policy cost_centers_read on public.cost_centers for select to authenticated
using (private.has_tenant_role(tenant_id));
drop policy if exists cost_centers_write on public.cost_centers;
create policy cost_centers_write on public.cost_centers for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

drop policy if exists expense_categories_read on public.expense_categories;
create policy expense_categories_read on public.expense_categories for select to authenticated
using (private.has_tenant_role(tenant_id));
drop policy if exists expense_categories_write on public.expense_categories;
create policy expense_categories_write on public.expense_categories for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses for select to authenticated
using (private.has_tenant_role(tenant_id));
drop policy if exists expenses_write on public.expenses;
create policy expenses_write on public.expenses for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

drop policy if exists product_profitability_rules_read on public.product_profitability_rules;
create policy product_profitability_rules_read on public.product_profitability_rules for select to authenticated
using (private.has_tenant_role(tenant_id));
drop policy if exists product_profitability_rules_write on public.product_profitability_rules;
create policy product_profitability_rules_write on public.product_profitability_rules for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

create or replace function private.sales_channel_variable_pct(p_channel_id uuid)
returns numeric language sql stable set search_path='' as $$
  select coalesce(
    tax_pct + payment_fee_pct + sales_commission_pct + marketplace_fee_pct +
    freight_subsidy_pct + anticipation_pct + expected_loss_pct + other_variable_pct,
    0
  )
  from public.sales_channels
  where id=p_channel_id and active;
$$;
revoke all on function private.sales_channel_variable_pct(uuid) from public, anon, authenticated;

create or replace function private.product_effective_cost(p_tenant_id uuid, p_product_id uuid)
returns numeric language plpgsql stable set search_path='' as $$
declare
  v_average numeric := 0;
  v_last numeric := 0;
  v_basis text := 'auto';
  v_replacement numeric;
  v_manual numeric;
  v_freight numeric := 0;
  v_packaging numeric := 0;
  v_other numeric := 0;
  v_loss numeric := 0;
  v_base numeric := 0;
begin
  select coalesce(average_cost,0), coalesce(last_purchase_cost,0)
    into v_average, v_last
  from public.products
  where tenant_id=p_tenant_id and id=p_product_id and deleted_at is null;

  if not found then return 0; end if;

  select cost_basis, replacement_cost, manual_cost, inbound_freight_value,
         packaging_cost, other_unit_cost, inventory_loss_pct
    into v_basis, v_replacement, v_manual, v_freight, v_packaging, v_other, v_loss
  from public.product_profitability_rules
  where tenant_id=p_tenant_id and product_id=p_product_id;

  if not found then v_basis := 'auto'; end if;

  v_base := case
    when v_basis='average' then v_average
    when v_basis='last' then v_last
    when v_basis='replacement' then coalesce(v_replacement,0)
    when v_basis='manual' then coalesce(v_manual,0)
    else coalesce(nullif(v_average,0), nullif(v_last,0), 0)
  end;

  return round(greatest(
    (v_base + coalesce(v_freight,0) + coalesce(v_packaging,0) + coalesce(v_other,0)) *
    (1 + coalesce(v_loss,0)/100), 0
  ), 4);
end;
$$;
revoke all on function private.product_effective_cost(uuid,uuid) from public, anon, authenticated;

create or replace function private.resolve_sales_channel(p_tenant_id uuid, p_product_id uuid, p_channel_id uuid)
returns uuid language plpgsql stable set search_path='' as $$
declare v_channel uuid;
begin
  if p_channel_id is not null and exists (
    select 1 from public.sales_channels where id=p_channel_id and tenant_id=p_tenant_id and active
  ) then return p_channel_id; end if;

  if p_product_id is not null then
    select preferred_channel_id into v_channel
    from public.product_profitability_rules
    where tenant_id=p_tenant_id and product_id=p_product_id;

    if v_channel is not null and exists (
      select 1 from public.sales_channels where id=v_channel and tenant_id=p_tenant_id and active
    ) then return v_channel; end if;
  end if;

  select default_sales_channel_id into v_channel
  from public.tenant_pricing_settings where tenant_id=p_tenant_id;

  if v_channel is not null and exists (
    select 1 from public.sales_channels where id=v_channel and tenant_id=p_tenant_id and active
  ) then return v_channel; end if;

  select id into v_channel
  from public.sales_channels
  where tenant_id=p_tenant_id and active
  order by is_default desc, created_at
  limit 1;

  return v_channel;
end;
$$;
revoke all on function private.resolve_sales_channel(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.simulate_product_profitability(
  p_tenant_id uuid,
  p_product_id uuid,
  p_channel_id uuid default null,
  p_target_margin_pct numeric default null,
  p_sale_price numeric default null,
  p_quantity numeric default 1
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid();
  v_cost numeric := 0;
  v_channel uuid;
  v_variable_pct numeric := 0;
  v_fixed_fee numeric := 0;
  v_target_margin numeric := 20;
  v_min_margin numeric := 10;
  v_current_price numeric := 0;
  v_sale_price numeric := 0;
  v_qty numeric := greatest(coalesce(p_quantity,1),1);
  v_denominator numeric;
  v_recommended numeric;
  v_floor numeric;
  v_contribution numeric;
  v_contribution_pct numeric;
  v_markup numeric;
  v_channel_name text;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if not private.has_tenant_role(p_tenant_id) then raise exception 'Sem permissão'; end if;

  select coalesce(price_b2c,0) into v_current_price
  from public.products
  where tenant_id=p_tenant_id and id=p_product_id and deleted_at is null;
  if not found then raise exception 'Produto não encontrado'; end if;

  v_cost := private.product_effective_cost(p_tenant_id,p_product_id);
  v_channel := private.resolve_sales_channel(p_tenant_id,p_product_id,p_channel_id);

  if v_channel is not null then
    select name, coalesce(private.sales_channel_variable_pct(id),0), coalesce(fixed_fee_per_sale,0)
      into v_channel_name, v_variable_pct, v_fixed_fee
    from public.sales_channels
    where id=v_channel and tenant_id=p_tenant_id;
  end if;

  select
    coalesce(p_target_margin_pct, r.target_margin_pct, s.default_target_margin_pct, 20),
    coalesce(r.min_margin_pct, s.default_min_margin_pct, 10)
  into v_target_margin, v_min_margin
  from public.tenant_pricing_settings s
  left join public.product_profitability_rules r
    on r.tenant_id=s.tenant_id and r.product_id=p_product_id
  where s.tenant_id=p_tenant_id;

  if v_target_margin < 0 or v_target_margin >= 95 then raise exception 'Margem desejada inválida'; end if;

  v_denominator := 1 - (v_variable_pct + v_target_margin)/100;
  if v_denominator <= 0 then
    raise exception 'Custos variáveis + margem desejada precisam ser menores que 100%%';
  end if;
  v_recommended := round((v_cost + (v_fixed_fee/v_qty))/v_denominator,2);

  v_denominator := 1 - (v_variable_pct + v_min_margin)/100;
  if v_denominator <= 0 then v_floor := null;
  else v_floor := round((v_cost + (v_fixed_fee/v_qty))/v_denominator,2); end if;

  v_sale_price := coalesce(p_sale_price, v_current_price, v_recommended, 0);
  if v_sale_price > 0 then
    v_contribution := round(v_sale_price - v_cost - (v_sale_price*v_variable_pct/100) - (v_fixed_fee/v_qty),4);
    v_contribution_pct := round((v_contribution/v_sale_price)*100,4);
    if v_cost > 0 then v_markup := round(((v_sale_price/v_cost)-1)*100,4); end if;
  else
    v_contribution := 0;
    v_contribution_pct := 0;
  end if;

  return jsonb_build_object(
    'ok',true,
    'product_id',p_product_id,
    'effective_cost',v_cost,
    'channel_id',v_channel,
    'channel_name',coalesce(v_channel_name,'Sem canal'),
    'variable_cost_pct',v_variable_pct,
    'fixed_fee_per_sale',v_fixed_fee,
    'quantity',v_qty,
    'target_margin_pct',v_target_margin,
    'min_margin_pct',v_min_margin,
    'current_price',v_current_price,
    'sale_price',v_sale_price,
    'recommended_price',v_recommended,
    'minimum_price',v_floor,
    'contribution_amount',v_contribution,
    'contribution_margin_pct',v_contribution_pct,
    'markup_pct',v_markup,
    'below_minimum',case when v_floor is null then false else v_sale_price < v_floor end
  );
end;
$$;
revoke all on function public.simulate_product_profitability(uuid,uuid,uuid,numeric,numeric,numeric) from public, anon;
grant execute on function public.simulate_product_profitability(uuid,uuid,uuid,numeric,numeric,numeric) to authenticated, service_role;

create or replace function private.snapshot_order_channel()
returns trigger language plpgsql set search_path='' as $$
declare v_channel uuid;
begin
  v_channel := private.resolve_sales_channel(new.tenant_id, null, new.sales_channel_id);
  new.sales_channel_id := v_channel;
  if v_channel is null then
    new.channel_variable_cost_pct_snapshot := 0;
    new.channel_fixed_fee_snapshot := 0;
  else
    select coalesce(private.sales_channel_variable_pct(id),0), coalesce(fixed_fee_per_sale,0)
      into new.channel_variable_cost_pct_snapshot, new.channel_fixed_fee_snapshot
    from public.sales_channels
    where id=v_channel and tenant_id=new.tenant_id;
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_order_channel() from public, anon, authenticated;

drop trigger if exists trg_snapshot_order_channel on public.orders;
create trigger trg_snapshot_order_channel
before insert or update of sales_channel_id on public.orders
for each row execute function private.snapshot_order_channel();

create or replace function private.snapshot_order_item_profitability()
returns trigger language plpgsql set search_path='' as $$
declare
  v_tenant uuid;
  v_variable_pct numeric := 0;
  v_cost numeric := 0;
  v_unit_price numeric := 0;
  v_contribution numeric := 0;
begin
  select tenant_id, coalesce(channel_variable_cost_pct_snapshot,0)
    into v_tenant, v_variable_pct
  from public.orders where id=new.order_id;

  if v_tenant is null then return new; end if;
  if new.tenant_id is null then new.tenant_id := v_tenant; end if;

  if new.product_id is not null then
    v_cost := private.product_effective_cost(v_tenant,new.product_id);
    new.unit_cost_snapshot := v_cost;
  else
    v_cost := coalesce(new.unit_cost_snapshot,0);
  end if;

  v_unit_price := coalesce(new.unit_price,0);
  v_contribution := v_unit_price - v_cost - (v_unit_price*v_variable_pct/100);
  new.contribution_margin_amount := round(v_contribution,4);
  new.contribution_margin_pct := case when v_unit_price>0 then round((v_contribution/v_unit_price)*100,4) else 0 end;
  return new;
end;
$$;
revoke all on function private.snapshot_order_item_profitability() from public, anon, authenticated;

drop trigger if exists trg_snapshot_order_item_profitability on public.order_items;
create trigger trg_snapshot_order_item_profitability
before insert or update of order_id, product_id, unit_price, quantity on public.order_items
for each row execute function private.snapshot_order_item_profitability();

create or replace function public.get_profitability_dashboard(
  p_tenant_id uuid,
  p_month date default date_trunc('month',current_date)::date
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid();
  v_start date := date_trunc('month',coalesce(p_month,current_date))::date;
  v_end date := (date_trunc('month',coalesce(p_month,current_date)) + interval '1 month')::date;
  v_revenue numeric := 0;
  v_cmv numeric := 0;
  v_variable numeric := 0;
  v_fixed_fees numeric := 0;
  v_contribution numeric := 0;
  v_fixed_expenses numeric := 0;
  v_variable_expenses numeric := 0;
  v_operating_result numeric := 0;
  v_margin_pct numeric := 0;
  v_break_even numeric := null;
  v_orders integer := 0;
  v_snapshot_items integer := 0;
  v_total_items integer := 0;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if not private.has_tenant_role(p_tenant_id,array['owner','admin','manager']) then raise exception 'Sem permissão'; end if;

  select coalesce(sum(o.total),0), count(*)::int, coalesce(sum(coalesce(o.channel_fixed_fee_snapshot,0)),0)
    into v_revenue, v_orders, v_fixed_fees
  from public.orders o
  where o.tenant_id=p_tenant_id
    and o.deleted_at is null
    and o.status in ('pago','faturado','enviado','entregue')
    and o.created_at >= v_start and o.created_at < v_end;

  with item_calc as (
    select oi.*,
           coalesce(o.channel_variable_cost_pct_snapshot,0) as variable_pct,
           coalesce(
             oi.unit_cost_snapshot,
             case when oi.product_id is not null then private.product_effective_cost(p_tenant_id,oi.product_id) else 0 end
           ) as resolved_cost
    from public.order_items oi
    join public.orders o on o.id=oi.order_id
    where oi.tenant_id=p_tenant_id
      and o.tenant_id=p_tenant_id
      and o.deleted_at is null
      and o.status in ('pago','faturado','enviado','entregue')
      and o.created_at >= v_start and o.created_at < v_end
  )
  select
    coalesce(sum(resolved_cost*quantity),0),
    coalesce(sum(unit_price*quantity*variable_pct/100),0),
    count(*)::int,
    count(*) filter(where unit_cost_snapshot is not null)::int
  into v_cmv, v_variable, v_total_items, v_snapshot_items
  from item_calc;

  select
    coalesce(sum(amount) filter(where kind='fixed' and status<>'canceled'),0),
    coalesce(sum(amount) filter(where kind='variable' and status<>'canceled'),0)
  into v_fixed_expenses, v_variable_expenses
  from public.expenses
  where tenant_id=p_tenant_id and competence_date>=v_start and competence_date<v_end;

  v_contribution := v_revenue - v_cmv - v_variable - v_fixed_fees - v_variable_expenses;
  v_operating_result := v_contribution - v_fixed_expenses;
  if v_revenue>0 then v_margin_pct := round((v_contribution/v_revenue)*100,4); end if;
  if v_margin_pct>0 then v_break_even := round(v_fixed_expenses/(v_margin_pct/100),2); end if;

  return jsonb_build_object(
    'month',v_start,
    'revenue',round(v_revenue,2),
    'orders',v_orders,
    'cmv',round(v_cmv,2),
    'channel_variable_costs',round(v_variable,2),
    'channel_fixed_fees',round(v_fixed_fees,2),
    'variable_expenses',round(v_variable_expenses,2),
    'contribution',round(v_contribution,2),
    'contribution_margin_pct',v_margin_pct,
    'fixed_expenses',round(v_fixed_expenses,2),
    'operating_result',round(v_operating_result,2),
    'break_even_revenue',v_break_even,
    'snapshot_coverage_pct',case when v_total_items>0 then round((v_snapshot_items::numeric/v_total_items::numeric)*100,2) else 100 end
  );
end;
$$;
revoke all on function public.get_profitability_dashboard(uuid,date) from public, anon;
grant execute on function public.get_profitability_dashboard(uuid,date) to authenticated, service_role;

-- Seeds neutros: não presumem taxas reais da empresa.
insert into public.sales_channels(tenant_id,code,name,is_default)
select t.id,'default','Padrão',true
from public.tenants t
where not exists (select 1 from public.sales_channels sc where sc.tenant_id=t.id)
on conflict (tenant_id,code) do nothing;

update public.tenant_pricing_settings s
set default_sales_channel_id=sc.id
from public.sales_channels sc
where sc.tenant_id=s.tenant_id and sc.is_default and s.default_sales_channel_id is null;

insert into public.cost_centers(tenant_id,name)
select t.id,x.name
from public.tenants t
cross join (values ('Administrativo'),('Comercial'),('Estoque'),('Logística'),('Marketing'),('E-commerce'),('TI')) as x(name)
on conflict (tenant_id,name) do nothing;

insert into public.expense_categories(tenant_id,name,default_kind)
select t.id,x.name,x.kind
from public.tenants t
cross join (values
  ('Aluguel','fixed'),('Folha e salários','fixed'),('Energia','fixed'),('Internet e sistemas','fixed'),
  ('Marketing','fixed'),('Pró-labore','fixed'),('Manutenção','fixed'),('Logística','variable'),
  ('Taxas financeiras','variable'),('Outras despesas','fixed')
) as x(name,kind)
on conflict (tenant_id,name) do nothing;
