-- Commercial stage: B2B price tables, seller discount limits, targets and commissions.
-- Table A = 8% below the B2B base price, B = 5%, C = base price.
-- All records are tenant-scoped and all final prices are recalculated on the server.

alter table public.sales_reps
  drop constraint if exists sales_reps_max_discount_pct_check;
alter table public.sales_reps
  add constraint sales_reps_max_discount_pct_check
  check (max_discount_pct >= 0 and max_discount_pct <= 100);

create table if not exists public.b2b_price_table_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  table_a_discount_pct numeric(5,2) not null default 8,
  table_b_discount_pct numeric(5,2) not null default 5,
  table_c_discount_pct numeric(5,2) not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint b2b_price_table_settings_tenant_key unique (tenant_id),
  constraint b2b_price_table_settings_discounts_check check (
    table_a_discount_pct between 0 and 100
    and table_b_discount_pct between 0 and 100
    and table_c_discount_pct between 0 and 100
    and table_a_discount_pct >= table_b_discount_pct
    and table_b_discount_pct >= table_c_discount_pct
  )
);

create table if not exists public.b2b_customer_price_tables (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  cnpj_digits text not null,
  price_table text not null default 'C',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, customer_id),
  constraint b2b_customer_price_tables_customer_tenant_fkey
    foreign key (customer_id, tenant_id)
    references public.customers(id, tenant_id)
    on delete cascade,
  constraint b2b_customer_price_tables_cnpj_check
    check (cnpj_digits ~ '^[0-9]{14}$'),
  constraint b2b_customer_price_tables_table_check
    check (price_table in ('A', 'B', 'C')),
  constraint b2b_customer_price_tables_tenant_cnpj_key
    unique (tenant_id, cnpj_digits)
);

create table if not exists public.seller_commission_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  enabled boolean not null default true,
  average_months integer not null default 3,
  outperform_rate_pct numeric(5,2) not null default 1.00,
  baseline_rate_pct numeric(5,2) not null default 0.50,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_commission_settings_tenant_key unique (tenant_id),
  constraint seller_commission_settings_months_check check (average_months = 3),
  constraint seller_commission_settings_rates_check check (
    outperform_rate_pct between 0 and 100
    and baseline_rate_pct between 0 and 100
  )
);

create table if not exists public.seller_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rep_id uuid not null,
  period_month date not null,
  target_amount numeric(14,2) not null default 0,
  target_units integer not null default 0,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_goals_rep_tenant_fkey
    foreign key (rep_id, tenant_id)
    references public.sales_reps(id, tenant_id)
    on delete cascade,
  constraint seller_goals_amount_check check (target_amount >= 0),
  constraint seller_goals_units_check check (target_units >= 0),
  constraint seller_goals_tenant_rep_month_key
    unique (tenant_id, rep_id, period_month)
);

create table if not exists public.seller_commission_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rep_id uuid not null,
  period_month date not null,
  eligible_sales numeric(14,2) not null default 0,
  previous_three_months_average numeric(14,2) not null default 0,
  rate_pct numeric(5,2) not null default 0,
  commission_amount numeric(14,2) not null default 0,
  sales_order_amount numeric(14,2) not null default 0,
  pos_sales_amount numeric(14,2) not null default 0,
  eligible_order_count integer not null default 0,
  eligible_pos_count integer not null default 0,
  status text not null default 'calculated',
  calculated_at timestamptz not null default now(),
  calculated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_commission_periods_rep_tenant_fkey
    foreign key (rep_id, tenant_id)
    references public.sales_reps(id, tenant_id)
    on delete cascade,
  constraint seller_commission_periods_month_key
    unique (tenant_id, rep_id, period_month),
  constraint seller_commission_periods_amounts_check check (
    eligible_sales >= 0
    and previous_three_months_average >= 0
    and commission_amount >= 0
    and sales_order_amount >= 0
    and pos_sales_amount >= 0
    and eligible_order_count >= 0
    and eligible_pos_count >= 0
  ),
  constraint seller_commission_periods_status_check
    check (status in ('calculated', 'approved', 'paid', 'cancelled'))
);

create index if not exists b2b_customer_price_tables_tenant_table_idx
  on public.b2b_customer_price_tables (tenant_id, price_table, active);
create index if not exists seller_goals_tenant_month_idx
  on public.seller_goals (tenant_id, period_month);
create index if not exists seller_commission_periods_tenant_month_idx
  on public.seller_commission_periods (tenant_id, period_month desc);
create index if not exists seller_commission_periods_rep_month_idx
  on public.seller_commission_periods (rep_id, tenant_id, period_month desc);

drop trigger if exists b2b_price_table_settings_set_updated_at on public.b2b_price_table_settings;
create trigger b2b_price_table_settings_set_updated_at
before update on public.b2b_price_table_settings
for each row execute function private.set_updated_at();

drop trigger if exists b2b_customer_price_tables_set_updated_at on public.b2b_customer_price_tables;
create trigger b2b_customer_price_tables_set_updated_at
before update on public.b2b_customer_price_tables
for each row execute function private.set_updated_at();

drop trigger if exists seller_commission_settings_set_updated_at on public.seller_commission_settings;
create trigger seller_commission_settings_set_updated_at
before update on public.seller_commission_settings
for each row execute function private.set_updated_at();

drop trigger if exists seller_goals_set_updated_at on public.seller_goals;
create trigger seller_goals_set_updated_at
before update on public.seller_goals
for each row execute function private.set_updated_at();

drop trigger if exists seller_commission_periods_set_updated_at on public.seller_commission_periods;
create trigger seller_commission_periods_set_updated_at
before update on public.seller_commission_periods
for each row execute function private.set_updated_at();

insert into public.b2b_price_table_settings (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

insert into public.seller_commission_settings (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

alter table public.b2b_price_table_settings enable row level security;
alter table public.b2b_customer_price_tables enable row level security;
alter table public.seller_commission_settings enable row level security;
alter table public.seller_goals enable row level security;
alter table public.seller_commission_periods enable row level security;

revoke all on table public.b2b_price_table_settings,
  public.b2b_customer_price_tables,
  public.seller_commission_settings,
  public.seller_goals,
  public.seller_commission_periods
  from anon;

revoke all on table public.b2b_price_table_settings,
  public.b2b_customer_price_tables,
  public.seller_commission_settings,
  public.seller_goals,
  public.seller_commission_periods
  from authenticated;

grant select, insert, update, delete on table public.b2b_price_table_settings,
  public.b2b_customer_price_tables,
  public.seller_commission_settings,
  public.seller_goals
  to authenticated;
grant select on table public.seller_commission_periods to authenticated;
grant all on table public.b2b_price_table_settings,
  public.b2b_customer_price_tables,
  public.seller_commission_settings,
  public.seller_goals,
  public.seller_commission_periods
  to service_role;

drop policy if exists b2b_price_table_settings_read on public.b2b_price_table_settings;
create policy b2b_price_table_settings_read on public.b2b_price_table_settings
for select to authenticated
using (private.has_tenant_role(tenant_id));

drop policy if exists b2b_price_table_settings_write on public.b2b_price_table_settings;
create policy b2b_price_table_settings_write on public.b2b_price_table_settings
for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

drop policy if exists b2b_customer_price_tables_read on public.b2b_customer_price_tables;
create policy b2b_customer_price_tables_read on public.b2b_customer_price_tables
for select to authenticated
using (private.has_tenant_role(tenant_id));

drop policy if exists b2b_customer_price_tables_write on public.b2b_customer_price_tables;
create policy b2b_customer_price_tables_write on public.b2b_customer_price_tables
for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

drop policy if exists seller_commission_settings_read on public.seller_commission_settings;
create policy seller_commission_settings_read on public.seller_commission_settings
for select to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

drop policy if exists seller_commission_settings_write on public.seller_commission_settings;
create policy seller_commission_settings_write on public.seller_commission_settings
for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

drop policy if exists seller_goals_read on public.seller_goals;
create policy seller_goals_read on public.seller_goals
for select to authenticated
using (
  private.has_tenant_role(tenant_id, array['owner','admin','manager'])
  or exists (
    select 1
    from public.sales_reps rep
    where rep.id = seller_goals.rep_id
      and rep.tenant_id = seller_goals.tenant_id
      and rep.user_id = auth.uid()
  )
);

drop policy if exists seller_goals_write on public.seller_goals;
create policy seller_goals_write on public.seller_goals
for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

drop policy if exists seller_commission_periods_read on public.seller_commission_periods;
create policy seller_commission_periods_read on public.seller_commission_periods
for select to authenticated
using (
  private.has_tenant_role(tenant_id, array['owner','admin','manager'])
  or exists (
    select 1
    from public.sales_reps rep
    where rep.id = seller_commission_periods.rep_id
      and rep.tenant_id = seller_commission_periods.tenant_id
      and rep.user_id = auth.uid()
  )
);

create or replace function public.calculate_seller_commission(
  p_tenant_id uuid,
  p_rep_id uuid,
  p_period_month date,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_period_start date := (date_trunc('month', p_period_month::timestamp))::date;
  v_period_end date;
  v_month_start date;
  v_month_end date;
  v_current_sales numeric := 0;
  v_current_sales_orders numeric := 0;
  v_current_pos_sales numeric := 0;
  v_current_order_count integer := 0;
  v_current_pos_count integer := 0;
  v_previous_total numeric := 0;
  v_previous_average numeric := 0;
  v_rate numeric := 0;
  v_commission numeric := 0;
  v_high_rate numeric := 1;
  v_base_rate numeric := 0.5;
  v_existing_status text;
  v_rep_user_id uuid;
  v_org_id uuid;
  v_offset integer;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_tenant_id is null or p_rep_id is null or p_period_month is null or p_actor_user_id is null then
    raise exception 'parâmetros de comissão incompletos';
  end if;
  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_user_id
      and membership.active
      and membership.role in ('owner','admin','manager')
  ) then
    raise exception 'usuário sem permissão para calcular comissão';
  end if;
  select rep.user_id
  into v_rep_user_id
  from public.sales_reps rep
  where rep.id = p_rep_id
    and rep.tenant_id = p_tenant_id
    and rep.active;
  if not found then
    raise exception 'vendedor ativo não encontrado';
  end if;
  select settings.outperform_rate_pct, settings.baseline_rate_pct
  into v_high_rate, v_base_rate
  from public.seller_commission_settings settings
  where settings.tenant_id = p_tenant_id
    and settings.enabled;
  if not found then
    v_high_rate := 1;
    v_base_rate := 0.5;
  end if;
  select period.status
  into v_existing_status
  from public.seller_commission_periods period
  where period.tenant_id = p_tenant_id
    and period.rep_id = p_rep_id
    and period.period_month = v_period_start;
  if v_existing_status in ('paid','cancelled') then
    return jsonb_build_object(
      'ok', true,
      'locked', true,
      'period_month', v_period_start,
      'status', v_existing_status
    );
  end if;
  v_period_end := (v_period_start + interval '1 month')::date;

  select
    coalesce(sum(coalesce(order_row.total, sale.total)), 0),
    count(*)::integer
  into v_current_sales_orders, v_current_order_count
  from public.sales_orders sale
  left join public.orders order_row
    on order_row.id = sale.order_id
   and order_row.tenant_id = sale.tenant_id
  where sale.tenant_id = p_tenant_id
    and sale.rep_id = p_rep_id
    and sale.status in ('enviado','convertido')
    and sale.created_at >= v_period_start
    and sale.created_at < v_period_end
    and (
      (sale.order_id is null)
      or order_row.status::text in ('pago','faturado','enviado','entregue')
    );

  select
    coalesce(sum(pos.total), 0),
    count(*)::integer
  into v_current_pos_sales, v_current_pos_count
  from public.pos_sales pos
  where pos.tenant_id = p_tenant_id
    and pos.operator_id = v_rep_user_id
    and pos.status = 'paid'
    and pos.created_at >= v_period_start
    and pos.created_at < v_period_end;

  v_current_sales := round(v_current_sales_orders + v_current_pos_sales, 2);

  for v_offset in 1..3 loop
    v_month_start := (v_period_start - make_interval(months => v_offset))::date;
    v_month_end := (v_month_start + interval '1 month')::date;
    select coalesce(sum(coalesce(order_row.total, sale.total)), 0)
    into v_previous_total
    from public.sales_orders sale
    left join public.orders order_row
      on order_row.id = sale.order_id
     and order_row.tenant_id = sale.tenant_id
    where sale.tenant_id = p_tenant_id
      and sale.rep_id = p_rep_id
      and sale.status in ('enviado','convertido')
      and sale.created_at >= v_month_start
      and sale.created_at < v_month_end
      and (
        sale.order_id is null
        or order_row.status::text in ('pago','faturado','enviado','entregue')
      );
    select v_previous_total + coalesce(sum(pos.total), 0)
    into v_previous_total
    from public.pos_sales pos
    where pos.tenant_id = p_tenant_id
      and pos.operator_id = v_rep_user_id
      and pos.status = 'paid'
      and pos.created_at >= v_month_start
      and pos.created_at < v_month_end;
    v_previous_total := coalesce(v_previous_total, 0);
    v_previous_average := v_previous_average + v_previous_total;
  end loop;

  v_previous_average := round(v_previous_average / 3, 2);
  v_rate := case when v_current_sales > v_previous_average then v_high_rate else v_base_rate end;
  v_commission := round(v_current_sales * v_rate / 100, 2);

  insert into public.seller_commission_periods (
    tenant_id, rep_id, period_month, eligible_sales,
    previous_three_months_average, rate_pct, commission_amount,
    sales_order_amount, pos_sales_amount, eligible_order_count,
    eligible_pos_count, status, calculated_at, calculated_by
  )
  values (
    p_tenant_id, p_rep_id, v_period_start, v_current_sales,
    v_previous_average, v_rate, v_commission,
    v_current_sales_orders, v_current_pos_sales, v_current_order_count,
    v_current_pos_count, 'calculated', now(), p_actor_user_id
  )
  on conflict (tenant_id, rep_id, period_month)
  do update set
    eligible_sales = excluded.eligible_sales,
    previous_three_months_average = excluded.previous_three_months_average,
    rate_pct = excluded.rate_pct,
    commission_amount = excluded.commission_amount,
    sales_order_amount = excluded.sales_order_amount,
    pos_sales_amount = excluded.pos_sales_amount,
    eligible_order_count = excluded.eligible_order_count,
    eligible_pos_count = excluded.eligible_pos_count,
    status = case
      when seller_commission_periods.status = 'approved' then 'approved'
      else 'calculated'
    end,
    calculated_at = excluded.calculated_at,
    calculated_by = excluded.calculated_by,
    updated_at = now();

  select tenant.organization_id
  into v_org_id
  from public.tenants tenant
  where tenant.id = p_tenant_id;
  insert into public.audit_events (
    organization_id, tenant_id, actor_user_id, action,
    resource_type, resource_id, after_data
  )
  values (
    v_org_id, p_tenant_id, p_actor_user_id, 'sales.commission_calculated',
    'seller_commission_period',
    p_rep_id::text || ':' || v_period_start::text,
    jsonb_build_object(
      'eligible_sales', v_current_sales,
      'previous_three_months_average', v_previous_average,
      'rate_pct', v_rate,
      'commission_amount', v_commission
    )
  );

  return jsonb_build_object(
    'ok', true,
    'locked', false,
    'period_month', v_period_start,
    'eligible_sales', v_current_sales,
    'previous_three_months_average', v_previous_average,
    'rate_pct', v_rate,
    'commission_amount', v_commission
  );
end;
$function$;

revoke all on function public.calculate_seller_commission(uuid, uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.calculate_seller_commission(uuid, uuid, date, uuid)
  to service_role;

create or replace function private.create_storefront_order(
  p_customer jsonb,
  p_items jsonb,
  p_payment_method text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  current_tenant_id uuid := private.requested_storefront_tenant_id();
  current_customer_id uuid;
  current_order_id uuid;
  current_warehouse_id uuid;
  current_is_b2b boolean := false;
  current_subtotal numeric := 0;
  current_price_table text := 'C';
  current_b2b_discount_pct numeric := 0;
  item jsonb;
  item_product public.products%rowtype;
  item_stock public.product_stock%rowtype;
  item_quantity integer;
  item_list_price numeric;
  item_unit_price numeric;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if current_tenant_id is null then
    raise exception 'valid storefront tenant required';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;
  if p_payment_method not in ('pix', 'cartao', 'boleto', 'faturado_b2b') then
    raise exception 'invalid payment method';
  end if;

  select sale.id
  into current_order_id
  from public.orders sale
  where sale.tenant_id = current_tenant_id
    and sale.user_id = current_user_id
    and sale.idempotency_key = p_idempotency_key;
  if current_order_id is not null then
    return current_order_id;
  end if;

  perform 1
  from public.tenants tenant
  where tenant.id = current_tenant_id
    and tenant.status = 'active';
  if not found then
    raise exception 'inactive tenant';
  end if;

  select coalesce(
    profile.customer_group in ('revendedor','oficina','distribuidor')
      and profile.b2b_status = 'approved',
    false
  )
  into current_is_b2b
  from public.profiles profile
  where profile.id = current_user_id;
  if p_payment_method = 'faturado_b2b'
    and not coalesce(current_is_b2b, false) then
    raise exception 'B2B billing is not authorized for this customer';
  end if;

  insert into public.customers (
    tenant_id, user_id, name, email, phone, document,
    customer_group, b2b_status
  )
  values (
    current_tenant_id,
    current_user_id,
    nullif(trim(p_customer->>'name'), ''),
    nullif(lower(trim(p_customer->>'email')), ''),
    nullif(trim(p_customer->>'phone'), ''),
    nullif(regexp_replace(p_customer->>'document', '\D', '', 'g'), ''),
    case when current_is_b2b then
      coalesce(
        (select profile.customer_group
         from public.profiles profile
         where profile.id = current_user_id),
        'b2c'
      )
    else 'b2c' end,
    case when current_is_b2b
      then 'approved'::public.b2b_approval_status
      else 'none'::public.b2b_approval_status
    end
  )
  on conflict (tenant_id, user_id)
  do update set
    name = excluded.name,
    email = excluded.email,
    phone = excluded.phone,
    document = excluded.document,
    updated_at = now()
  returning id into current_customer_id;

  if current_is_b2b then
    select
      coalesce(assignment.price_table, 'C'),
      case coalesce(assignment.price_table, 'C')
        when 'A' then coalesce(settings.table_a_discount_pct, 8)
        when 'B' then coalesce(settings.table_b_discount_pct, 5)
        else coalesce(settings.table_c_discount_pct, 0)
      end
    into current_price_table, current_b2b_discount_pct
    from (select 1) seed
    left join public.b2b_customer_price_tables assignment
      on assignment.tenant_id = current_tenant_id
     and assignment.customer_id = current_customer_id
     and assignment.active
    left join public.b2b_price_table_settings settings
      on settings.tenant_id = current_tenant_id
     and settings.active
    limit 1;
  end if;

  select warehouse.id
  into current_warehouse_id
  from public.warehouses warehouse
  where warehouse.tenant_id = current_tenant_id
    and warehouse.active
  order by warehouse.is_default desc, warehouse.created_at
  limit 1;
  if current_warehouse_id is null then
    raise exception 'tenant has no active warehouse';
  end if;

  update public.stock_reservations reservation
  set status = 'expired', updated_at = now()
  where reservation.tenant_id = current_tenant_id
    and reservation.status = 'active'
    and reservation.expires_at <= now();

  update public.product_stock stock
  set reserved = greatest(stock.reserved - expired.quantity, 0)
  from (
    select reservation.product_id, reservation.warehouse_id,
      sum(reservation.quantity)::integer quantity
    from public.stock_reservations reservation
    where reservation.tenant_id = current_tenant_id
      and reservation.status = 'expired'
      and reservation.updated_at >= transaction_timestamp()
    group by reservation.product_id, reservation.warehouse_id
  ) expired
  where stock.tenant_id = current_tenant_id
    and stock.product_id = expired.product_id
    and stock.warehouse_id = expired.warehouse_id;

  insert into public.orders (
    tenant_id, customer_id, user_id, idempotency_key,
    status, is_b2b, b2b_price_table, b2b_price_discount_pct,
    subtotal, shipping, discount, total,
    payment_method, customer_name, customer_email, customer_phone,
    customer_document, shipping_zip, shipping_street, shipping_number,
    shipping_complement, shipping_neighborhood, shipping_city,
    shipping_state, notes
  )
  values (
    current_tenant_id, current_customer_id, current_user_id,
    p_idempotency_key, 'aguardando_pagamento', current_is_b2b,
    case when current_is_b2b then current_price_table end,
    case when current_is_b2b then current_b2b_discount_pct else 0 end,
    0, 0, 0, 0, p_payment_method,
    nullif(trim(p_customer->>'name'), ''),
    nullif(lower(trim(p_customer->>'email'), '')),
    nullif(trim(p_customer->>'phone'), ''),
    nullif(trim(p_customer->>'document'), ''),
    nullif(trim(p_customer->>'shipping_zip'), ''),
    nullif(trim(p_customer->>'shipping_street'), ''),
    nullif(trim(p_customer->>'shipping_number'), ''),
    nullif(trim(p_customer->>'shipping_complement'), ''),
    nullif(trim(p_customer->>'shipping_neighborhood'), ''),
    nullif(trim(p_customer->>'shipping_city'), ''),
    upper(nullif(trim(p_customer->>'shipping_state'), '')),
    nullif(trim(p_customer->>'notes'), '')
  )
  returning id into current_order_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_quantity := (item->>'quantity')::integer;
    if item_quantity <= 0 then
      raise exception 'item quantity must be positive';
    end if;

    select product.*
    into item_product
    from public.products product
    where product.id = (item->>'product_id')::uuid
      and product.tenant_id = current_tenant_id
      and product.active
    for share;
    if not found then
      raise exception 'product unavailable';
    end if;

    item_list_price := case
      when current_is_b2b then coalesce(
        item_product.price_b2b,
        item_product.sale_price_b2c,
        item_product.price_b2c
      )
      else coalesce(item_product.sale_price_b2c, item_product.price_b2c)
    end;
    if item_list_price is null or item_list_price < 0 then
      raise exception 'product has no valid price';
    end if;
    item_unit_price := round(
      item_list_price * (1 - current_b2b_discount_pct / 100),
      2
    );

    insert into public.product_stock (
      tenant_id, product_id, warehouse_id, on_hand, reserved
    )
    values (
      current_tenant_id, item_product.id, current_warehouse_id,
      greatest(coalesce(item_product.stock, 0), 0), 0
    )
    on conflict (tenant_id, product_id, warehouse_id) do nothing;

    select stock.*
    into item_stock
    from public.product_stock stock
    where stock.tenant_id = current_tenant_id
      and stock.product_id = item_product.id
      and stock.warehouse_id = current_warehouse_id
    for update;

    if item_stock.on_hand - item_stock.reserved < item_quantity then
      raise exception 'insufficient stock for product %', item_product.sku;
    end if;

    update public.product_stock
    set reserved = reserved + item_quantity
    where id = item_stock.id;

    insert into public.order_items (
      tenant_id, order_id, product_id, sku, name,
      quantity, list_price, unit_price, price_table,
      price_discount_pct, discount_amount, total
    )
    values (
      current_tenant_id, current_order_id, item_product.id,
      item_product.sku, item_product.name, item_quantity,
      item_list_price,
      item_unit_price,
      case when current_is_b2b then current_price_table end,
      case when current_is_b2b then current_b2b_discount_pct else 0 end,
      round((item_list_price - item_unit_price) * item_quantity, 2),
      item_unit_price * item_quantity
    );

    insert into public.stock_reservations (
      tenant_id, order_id, product_id, warehouse_id, quantity
    )
    values (
      current_tenant_id, current_order_id, item_product.id,
      current_warehouse_id, item_quantity
    );

    current_subtotal := current_subtotal + item_unit_price * item_quantity;
  end loop;

  update public.orders
  set subtotal = current_subtotal,
      total = current_subtotal
  where id = current_order_id
    and tenant_id = current_tenant_id;

  return current_order_id;
end;
$function$;

alter table public.orders
  add column if not exists b2b_price_table text,
  add column if not exists b2b_price_discount_pct numeric(5,2) not null default 0;

alter table public.orders
  drop constraint if exists orders_b2b_price_table_check;
alter table public.orders
  add constraint orders_b2b_price_table_check
  check (b2b_price_table is null or b2b_price_table in ('A','B','C'));
alter table public.orders
  drop constraint if exists orders_b2b_price_discount_pct_check;
alter table public.orders
  add constraint orders_b2b_price_discount_pct_check
  check (b2b_price_discount_pct between 0 and 100);

alter table public.order_items
  add column if not exists list_price numeric not null default 0,
  add column if not exists price_table text,
  add column if not exists price_discount_pct numeric(5,2) not null default 0,
  add column if not exists discount_amount numeric not null default 0;

update public.order_items
set list_price = unit_price,
    price_discount_pct = 0,
    discount_amount = 0
where list_price = 0;

alter table public.order_items
  drop constraint if exists order_items_price_table_check;
alter table public.order_items
  add constraint order_items_price_table_check
  check (price_table is null or price_table in ('A','B','C'));
alter table public.order_items
  drop constraint if exists order_items_price_discount_pct_check;
alter table public.order_items
  add constraint order_items_price_discount_pct_check
  check (price_discount_pct between 0 and 100);
alter table public.order_items
  drop constraint if exists order_items_discount_amount_check;
alter table public.order_items
  add constraint order_items_discount_amount_check
  check (discount_amount >= 0);

comment on table public.b2b_price_table_settings is
  'Tenant B2B price table policy. A and B are percentages below the B2B base (table C).';
comment on table public.b2b_customer_price_tables is
  'Customer CNPJ to B2B price table assignment.';
comment on table public.seller_commission_periods is
  'Monthly seller commission snapshot calculated from sent/converted assisted sales and paid POS sales.';
comment on function public.calculate_seller_commission(uuid, uuid, date, uuid) is
  'Compares current month sales with the strict average of the previous three months: above average pays 1%, otherwise 0.5%.';

notify pgrst, 'reload schema';