begin;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  phone text,
  document text,
  customer_group public.customer_group not null default 'b2c',
  b2b_status public.b2b_approval_status not null default 'none',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_id_tenant_key unique (id, tenant_id),
  constraint customers_tenant_user_key unique (tenant_id, user_id),
  constraint customers_tenant_document_key unique (tenant_id, document)
);

alter table public.customers enable row level security;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

alter table public.sales_reps add column tenant_id uuid;
alter table public.sales_rep_customers add column tenant_id uuid;
alter table public.sales_orders add column tenant_id uuid;
alter table public.quotes add column tenant_id uuid;
alter table public.quote_items add column tenant_id uuid;
alter table public.orders add column tenant_id uuid;
alter table public.orders add column customer_id uuid;
alter table public.orders add column idempotency_key uuid;
alter table public.order_items add column tenant_id uuid;

update public.sales_reps rep
set tenant_id = membership.tenant_id
from public.tenant_memberships membership
join public.tenants tenant on tenant.id = membership.tenant_id
where membership.user_id = rep.user_id
  and membership.active
  and tenant.environment = 'production';

update public.sales_rep_customers link
set tenant_id = rep.tenant_id
from public.sales_reps rep
where rep.id = link.rep_id;

update public.sales_orders sale
set tenant_id = rep.tenant_id
from public.sales_reps rep
where rep.id = sale.rep_id;

update public.quotes quote
set tenant_id = coalesce(
  (select branch.tenant_id from public.branches branch where branch.id = quote.branch_id),
  (select rep.tenant_id from public.sales_reps rep where rep.id = quote.sales_rep_id),
  (select tenant.id from public.tenants tenant where tenant.environment = 'production' limit 1)
);

update public.quote_items item
set tenant_id = quote.tenant_id
from public.quotes quote
where quote.id = item.quote_id;

update public.orders sale
set tenant_id = membership.tenant_id
from public.tenant_memberships membership
join public.tenants tenant on tenant.id = membership.tenant_id
where membership.user_id = sale.user_id
  and membership.active
  and tenant.environment = 'production';

update public.order_items item
set tenant_id = sale.tenant_id
from public.orders sale
where sale.id = item.order_id;

do $migration$
begin
  if exists (select 1 from public.sales_reps where tenant_id is null)
    or exists (select 1 from public.sales_rep_customers where tenant_id is null)
    or exists (select 1 from public.sales_orders where tenant_id is null)
    or exists (select 1 from public.quotes where tenant_id is null)
    or exists (select 1 from public.quote_items where tenant_id is null)
    or exists (select 1 from public.orders where tenant_id is null)
    or exists (select 1 from public.order_items where tenant_id is null)
  then
    raise exception 'commercial flow contains rows without a resolvable tenant';
  end if;
end;
$migration$;

alter table public.sales_reps alter column tenant_id set not null;
alter table public.sales_rep_customers alter column tenant_id set not null;
alter table public.sales_orders alter column tenant_id set not null;
alter table public.quotes alter column tenant_id set not null;
alter table public.quote_items alter column tenant_id set not null;
alter table public.orders alter column tenant_id set not null;
alter table public.order_items alter column tenant_id set not null;

insert into public.customers (
  tenant_id, user_id, name, email, phone, document,
  customer_group, b2b_status
)
select distinct on (sale.tenant_id, sale.user_id)
  sale.tenant_id,
  sale.user_id,
  sale.customer_name,
  coalesce(sale.customer_email, auth_user.email),
  sale.customer_phone,
  sale.customer_document,
  coalesce(profile.customer_group, 'b2c'),
  coalesce(profile.b2b_status, 'none')
from public.orders sale
left join auth.users auth_user on auth_user.id = sale.user_id
left join public.profiles profile on profile.id = sale.user_id
order by sale.tenant_id, sale.user_id, sale.created_at desc
on conflict (tenant_id, user_id) do nothing;

insert into public.customers (
  tenant_id, user_id, name, email, phone,
  customer_group, b2b_status
)
select distinct on (quote.tenant_id, quote.customer_id)
  quote.tenant_id,
  quote.customer_id,
  coalesce(quote.customer_name, profile.full_name, auth_user.email, 'Cliente'),
  coalesce(quote.customer_email, auth_user.email),
  coalesce(quote.customer_phone, profile.phone),
  coalesce(profile.customer_group, 'b2c'),
  coalesce(profile.b2b_status, 'none')
from public.quotes quote
left join auth.users auth_user on auth_user.id = quote.customer_id
left join public.profiles profile on profile.id = quote.customer_id
where quote.customer_id is not null
order by quote.tenant_id, quote.customer_id, quote.created_at desc
on conflict (tenant_id, user_id) do nothing;

insert into public.customers (
  tenant_id, user_id, name, email, phone,
  customer_group, b2b_status
)
select distinct on (link.tenant_id, link.customer_id)
  link.tenant_id,
  link.customer_id,
  coalesce(profile.full_name, auth_user.email, link.lead_name, 'Cliente'),
  coalesce(auth_user.email, link.lead_email),
  coalesce(profile.phone, link.lead_phone),
  coalesce(profile.customer_group, 'b2c'),
  coalesce(profile.b2b_status, 'none')
from public.sales_rep_customers link
left join auth.users auth_user on auth_user.id = link.customer_id
left join public.profiles profile on profile.id = link.customer_id
where link.customer_id is not null
order by link.tenant_id, link.customer_id, link.created_at desc
on conflict (tenant_id, user_id) do nothing;

insert into public.customers (
  tenant_id, user_id, name, email, phone, document,
  customer_group, b2b_status
)
select distinct on (sale.tenant_id, sale.customer_id)
  sale.tenant_id,
  sale.customer_id,
  coalesce(profile.full_name, auth_user.email, sale.lead_name, 'Cliente'),
  coalesce(auth_user.email, sale.lead_email),
  coalesce(profile.phone, sale.lead_phone),
  sale.lead_cnpj,
  coalesce(profile.customer_group, 'b2c'),
  coalesce(profile.b2b_status, 'none')
from public.sales_orders sale
left join auth.users auth_user on auth_user.id = sale.customer_id
left join public.profiles profile on profile.id = sale.customer_id
where sale.customer_id is not null
order by sale.tenant_id, sale.customer_id, sale.created_at desc
on conflict (tenant_id, user_id) do nothing;

update public.orders sale
set customer_id = customer.id
from public.customers customer
where customer.tenant_id = sale.tenant_id
  and customer.user_id = sale.user_id;

update public.quotes quote
set customer_id = customer.id
from public.customers customer
where customer.tenant_id = quote.tenant_id
  and customer.user_id = quote.customer_id;

update public.sales_rep_customers link
set customer_id = customer.id
from public.customers customer
where customer.tenant_id = link.tenant_id
  and customer.user_id = link.customer_id;

update public.sales_orders sale
set customer_id = customer.id
from public.customers customer
where customer.tenant_id = sale.tenant_id
  and customer.user_id = sale.customer_id;

alter table public.sales_reps
  drop constraint sales_reps_email_key,
  drop constraint sales_reps_user_id_key,
  add constraint sales_reps_id_tenant_key unique (id, tenant_id),
  add constraint sales_reps_tenant_email_key unique (tenant_id, email),
  add constraint sales_reps_tenant_user_key unique (tenant_id, user_id),
  add constraint sales_reps_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;

alter table public.sales_rep_customers
  drop constraint sales_rep_customers_customer_id_fkey,
  drop constraint sales_rep_customers_rep_id_fkey,
  add constraint sales_rep_customers_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  add constraint sales_rep_customers_rep_tenant_fkey
    foreign key (rep_id, tenant_id) references public.sales_reps(id, tenant_id) on delete cascade,
  add constraint sales_rep_customers_customer_tenant_fkey
    foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete cascade;

alter table public.quotes
  drop constraint quotes_branch_id_fkey,
  drop constraint quotes_customer_id_fkey,
  drop constraint quotes_number_key,
  drop constraint quotes_sales_rep_id_fkey,
  add constraint quotes_id_tenant_key unique (id, tenant_id),
  add constraint quotes_tenant_number_key unique (tenant_id, number),
  add constraint quotes_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  add constraint quotes_branch_tenant_fkey
    foreign key (branch_id, tenant_id) references public.branches(id, tenant_id) on delete set null (branch_id),
  add constraint quotes_customer_tenant_fkey
    foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete set null (customer_id),
  add constraint quotes_sales_rep_tenant_fkey
    foreign key (sales_rep_id, tenant_id) references public.sales_reps(id, tenant_id) on delete set null (sales_rep_id);

alter table public.quote_items
  drop constraint quote_items_product_id_fkey,
  drop constraint quote_items_quote_id_fkey,
  add constraint quote_items_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  add constraint quote_items_quote_tenant_fkey
    foreign key (quote_id, tenant_id) references public.quotes(id, tenant_id) on delete cascade,
  add constraint quote_items_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete set null (product_id);

alter table public.orders
  add constraint orders_id_tenant_key unique (id, tenant_id),
  add constraint orders_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  add constraint orders_customer_tenant_fkey
    foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete set null (customer_id),
  add constraint orders_tenant_user_idempotency_key
    unique (tenant_id, user_id, idempotency_key);

alter table public.sales_orders
  drop constraint sales_orders_customer_id_fkey,
  drop constraint sales_orders_rep_id_fkey,
  drop constraint sales_orders_order_id_fkey,
  add constraint sales_orders_id_tenant_key unique (id, tenant_id),
  add constraint sales_orders_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  add constraint sales_orders_rep_tenant_fkey
    foreign key (rep_id, tenant_id) references public.sales_reps(id, tenant_id) on delete restrict,
  add constraint sales_orders_customer_tenant_fkey
    foreign key (customer_id, tenant_id) references public.customers(id, tenant_id) on delete set null (customer_id),
  add constraint sales_orders_order_tenant_fkey
    foreign key (order_id, tenant_id) references public.orders(id, tenant_id) on delete set null (order_id);

alter table public.order_items
  drop constraint order_items_order_id_fkey,
  drop constraint order_items_product_id_fkey,
  add constraint order_items_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  add constraint order_items_order_tenant_fkey
    foreign key (order_id, tenant_id) references public.orders(id, tenant_id) on delete cascade,
  add constraint order_items_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete set null (product_id),
  add constraint order_items_quantity_check check (quantity > 0),
  add constraint order_items_prices_check check (unit_price >= 0 and total >= 0);

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  product_id uuid not null,
  warehouse_id uuid not null,
  quantity integer not null check (quantity > 0),
  status text not null default 'active'
    check (status in ('active', 'consumed', 'released', 'expired')),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_reservations_order_tenant_fkey
    foreign key (order_id, tenant_id) references public.orders(id, tenant_id) on delete cascade,
  constraint stock_reservations_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products(id, tenant_id),
  constraint stock_reservations_warehouse_tenant_fkey
    foreign key (warehouse_id, tenant_id) references public.warehouses(id, tenant_id),
  constraint stock_reservations_order_product_warehouse_key
    unique (tenant_id, order_id, product_id, warehouse_id)
);

alter table public.stock_reservations enable row level security;
create trigger trg_stock_reservations_updated_at
before update on public.stock_reservations
for each row execute function public.set_updated_at();

create index idx_customers_tenant_email on public.customers(tenant_id, email);
create index idx_customers_user on public.customers(user_id) where user_id is not null;
create index idx_sales_reps_tenant_active on public.sales_reps(tenant_id, active);
create index idx_sales_reps_user on public.sales_reps(user_id) where user_id is not null;
create index idx_sales_reps_invited_by on public.sales_reps(invited_by) where invited_by is not null;
create index idx_sales_rep_customers_tenant on public.sales_rep_customers(tenant_id);
create index idx_sales_rep_customers_rep_tenant on public.sales_rep_customers(rep_id, tenant_id);
create index idx_sales_rep_customers_customer_tenant on public.sales_rep_customers(customer_id, tenant_id);
create index idx_sales_orders_tenant_created on public.sales_orders(tenant_id, created_at desc);
create index idx_sales_orders_rep_tenant on public.sales_orders(rep_id, tenant_id);
create index idx_sales_orders_customer_tenant on public.sales_orders(customer_id, tenant_id);
create index idx_sales_orders_order_tenant on public.sales_orders(order_id, tenant_id);
create index idx_quotes_tenant_created on public.quotes(tenant_id, created_at desc);
create index idx_quotes_branch_tenant on public.quotes(branch_id, tenant_id);
create index idx_quotes_customer_tenant on public.quotes(customer_id, tenant_id);
create index idx_quotes_sales_rep_tenant on public.quotes(sales_rep_id, tenant_id);
create index idx_quotes_created_by on public.quotes(created_by) where created_by is not null;
create index idx_quote_items_quote_tenant on public.quote_items(quote_id, tenant_id);
create index idx_quote_items_product_tenant on public.quote_items(product_id, tenant_id);
create index idx_quote_items_tenant on public.quote_items(tenant_id);
create index idx_orders_tenant_created on public.orders(tenant_id, created_at desc);
create index idx_orders_tenant_user on public.orders(tenant_id, user_id);
create index idx_orders_user on public.orders(user_id);
create index idx_orders_customer_tenant on public.orders(customer_id, tenant_id);
create index idx_order_items_order_tenant on public.order_items(order_id, tenant_id);
create index idx_order_items_product_tenant on public.order_items(product_id, tenant_id);
create index idx_order_items_tenant on public.order_items(tenant_id);
create index idx_stock_reservations_tenant_expiry
  on public.stock_reservations(tenant_id, expires_at) where status = 'active';
create index idx_stock_reservations_order_tenant on public.stock_reservations(order_id, tenant_id);
create index idx_stock_reservations_product_tenant on public.stock_reservations(product_id, tenant_id);
create index idx_stock_reservations_warehouse_tenant on public.stock_reservations(warehouse_id, tenant_id);

do $policies$
declare target_table text; policy_row record;
begin
  foreach target_table in array array[
    'customers', 'sales_reps', 'sales_rep_customers', 'sales_orders',
    'quotes', 'quote_items', 'orders', 'order_items', 'stock_reservations'
  ]
  loop
    for policy_row in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = target_table
    loop
      execute format('drop policy %I on public.%I', policy_row.policyname, target_table);
    end loop;
  end loop;
end;
$policies$;

alter table public.sales_reps enable row level security;
alter table public.sales_rep_customers enable row level security;
alter table public.sales_orders enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy customers_tenant_read on public.customers
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_tenant_role(tenant_id, null))
);
create policy customers_self_update on public.customers
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy customers_staff_write on public.customers
for all to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])));

create policy sales_reps_tenant_read on public.sales_reps
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_tenant_role(tenant_id, null))
);
create policy sales_reps_tenant_write on public.sales_reps
for all to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])));

create policy sales_rep_customers_tenant_read on public.sales_rep_customers
for select to authenticated
using (
  (select private.has_tenant_role(tenant_id, null))
  or exists (
    select 1 from public.sales_reps rep
    where rep.id = sales_rep_customers.rep_id
      and rep.tenant_id = sales_rep_customers.tenant_id
      and rep.user_id = (select auth.uid())
  )
);
create policy sales_rep_customers_tenant_write on public.sales_rep_customers
for all to authenticated
using (
  (select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales']))
  or exists (
    select 1 from public.sales_reps rep
    where rep.id = sales_rep_customers.rep_id
      and rep.tenant_id = sales_rep_customers.tenant_id
      and rep.user_id = (select auth.uid())
  )
)
with check (
  (select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales']))
  or exists (
    select 1 from public.sales_reps rep
    where rep.id = sales_rep_customers.rep_id
      and rep.tenant_id = sales_rep_customers.tenant_id
      and rep.user_id = (select auth.uid())
  )
);

create policy sales_orders_tenant_read on public.sales_orders
for select to authenticated
using (
  (select private.has_tenant_role(tenant_id, null))
  or exists (
    select 1 from public.sales_reps rep
    where rep.id = sales_orders.rep_id
      and rep.tenant_id = sales_orders.tenant_id
      and rep.user_id = (select auth.uid())
  )
);
create policy sales_orders_tenant_write on public.sales_orders
for all to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])));

create policy quotes_tenant_read on public.quotes
for select to authenticated
using (
  (select private.has_tenant_role(tenant_id, null))
  or exists (
    select 1 from public.customers customer
    where customer.id = quotes.customer_id
      and customer.tenant_id = quotes.tenant_id
      and customer.user_id = (select auth.uid())
  )
);
create policy quotes_tenant_write on public.quotes
for all to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])));

create policy quote_items_tenant_read on public.quote_items
for select to authenticated
using (
  (select private.has_tenant_role(tenant_id, null))
  or exists (
    select 1 from public.quotes quote
    join public.customers customer
      on customer.id = quote.customer_id and customer.tenant_id = quote.tenant_id
    where quote.id = quote_items.quote_id
      and quote.tenant_id = quote_items.tenant_id
      and customer.user_id = (select auth.uid())
  )
);
create policy quote_items_tenant_write on public.quote_items
for all to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])));

create policy orders_tenant_read on public.orders
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_tenant_role(tenant_id, null))
);
create policy orders_staff_update on public.orders
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales','cashier','finance'])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales','cashier','finance'])));

create policy order_items_tenant_read on public.order_items
for select to authenticated
using (
  (select private.has_tenant_role(tenant_id, null))
  or exists (
    select 1 from public.orders sale
    where sale.id = order_items.order_id
      and sale.tenant_id = order_items.tenant_id
      and sale.user_id = (select auth.uid())
  )
);

create policy stock_reservations_tenant_read on public.stock_reservations
for select to authenticated
using (
  (select private.has_tenant_role(tenant_id, null))
  or exists (
    select 1 from public.orders sale
    where sale.id = stock_reservations.order_id
      and sale.tenant_id = stock_reservations.tenant_id
      and sale.user_id = (select auth.uid())
  )
);

revoke all on table public.customers from anon, authenticated;
revoke all on table public.sales_reps from anon, authenticated;
revoke all on table public.sales_rep_customers from anon, authenticated;
revoke all on table public.sales_orders from anon, authenticated;
revoke all on table public.quotes from anon, authenticated;
revoke all on table public.quote_items from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;
revoke all on table public.stock_reservations from anon, authenticated;
grant select on public.customers to authenticated;
grant update (name, email, phone, document) on public.customers to authenticated;
grant select, insert, update, delete on public.sales_reps to authenticated;
grant select, insert, update, delete on public.sales_rep_customers to authenticated;
grant select, insert, update, delete on public.sales_orders to authenticated;
grant select, insert, update, delete on public.quotes to authenticated;
grant select, insert, update, delete on public.quote_items to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.stock_reservations to authenticated;

create or replace function public.create_storefront_order(
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
  item jsonb;
  item_product public.products%rowtype;
  item_stock public.product_stock%rowtype;
  item_quantity integer;
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

  select sale.id into current_order_id
  from public.orders sale
  where sale.tenant_id = current_tenant_id
    and sale.user_id = current_user_id
    and sale.idempotency_key = p_idempotency_key;
  if current_order_id is not null then
    return current_order_id;
  end if;

  perform 1 from public.tenants tenant
  where tenant.id = current_tenant_id and tenant.status = 'active';
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
  if p_payment_method = 'faturado_b2b' and not coalesce(current_is_b2b, false) then
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
      coalesce((select profile.customer_group from public.profiles profile where profile.id = current_user_id), 'b2c')
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

  select warehouse.id into current_warehouse_id
  from public.warehouses warehouse
  where warehouse.tenant_id = current_tenant_id and warehouse.active
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
    select reservation.product_id, reservation.warehouse_id, sum(reservation.quantity)::integer quantity
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
    status, is_b2b, subtotal, shipping, discount, total,
    payment_method, customer_name, customer_email, customer_phone,
    customer_document, shipping_zip, shipping_street, shipping_number,
    shipping_complement, shipping_neighborhood, shipping_city, shipping_state,
    notes
  )
  values (
    current_tenant_id, current_customer_id, current_user_id, p_idempotency_key,
    'aguardando_pagamento', current_is_b2b, 0, 0, 0, 0,
    p_payment_method,
    nullif(trim(p_customer->>'name'), ''),
    nullif(lower(trim(p_customer->>'email')), ''),
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

    select product.* into item_product
    from public.products product
    where product.id = (item->>'product_id')::uuid
      and product.tenant_id = current_tenant_id
      and product.active
    for share;
    if not found then
      raise exception 'product unavailable';
    end if;

    item_unit_price := case
      when current_is_b2b then coalesce(
        item_product.price_b2b,
        item_product.sale_price_b2c, item_product.price_b2c
      )
      else coalesce(item_product.sale_price_b2c, item_product.price_b2c)
    end;
    if item_unit_price is null or item_unit_price < 0 then
      raise exception 'product has no valid price';
    end if;

    insert into public.product_stock (
      tenant_id, product_id, warehouse_id, on_hand, reserved
    )
    values (
      current_tenant_id, item_product.id, current_warehouse_id,
      greatest(coalesce(item_product.stock, 0), 0), 0
    )
    on conflict (tenant_id, product_id, warehouse_id) do nothing;

    select stock.* into item_stock
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
      quantity, unit_price, total
    )
    values (
      current_tenant_id, current_order_id, item_product.id,
      item_product.sku, item_product.name, item_quantity,
      item_unit_price, item_unit_price * item_quantity
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
  set subtotal = current_subtotal, total = current_subtotal
  where id = current_order_id and tenant_id = current_tenant_id;

  return current_order_id;
end;
$function$;

revoke all on function public.create_storefront_order(jsonb, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_storefront_order(jsonb, jsonb, text, uuid) to authenticated;

commit;
