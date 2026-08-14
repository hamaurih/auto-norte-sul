-- Módulo Suprimentos: Fornecedores + Pedidos de compra + Recebimento
-- + postagem transacional idempotente de estoque e custo.
--
-- Reaproveita os padrões existentes: tenant_id, private.has_tenant_role(uuid, text[]),
-- private.set_updated_at(), product_stock, stock_movements, audit_events.
-- Não altera PDV, catálogo, e-commerce, B2B nem Bling.
--
-- Este projeto DEV usa Supabase externo (pleuoxzocgoajmymipqi): aplique este
-- arquivo manualmente no SQL Editor, como os demais em supabase/manual/.

begin;

-- ============================================================
-- 1. Colunas de custo em products (não altera preço de venda)
-- ============================================================
alter table public.products
  add column if not exists last_purchase_cost numeric(14, 4),
  add column if not exists average_cost numeric(14, 4),
  add column if not exists last_purchase_at timestamptz;

-- ============================================================
-- 2. Contadores sequenciais por tenant
-- ============================================================
create table if not exists public.supply_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('purchase_order', 'goods_receipt')),
  last_number integer not null default 0,
  primary key (tenant_id, kind)
);

create or replace function private.next_supply_number(target_tenant_id uuid, target_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_value integer;
begin
  insert into public.supply_counters as counters (tenant_id, kind, last_number)
  values (target_tenant_id, target_kind, 1)
  on conflict (tenant_id, kind)
  do update set last_number = counters.last_number + 1
  returning counters.last_number into next_value;

  return next_value;
end;
$$;

revoke all on function private.next_supply_number(uuid, text) from public;

-- ============================================================
-- 3. Fornecedores
-- ============================================================
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  legal_name text not null,
  trade_name text,
  tax_id text,
  state_tax_id text,
  email text,
  phone text,
  whatsapp text,
  address text,
  city text,
  state text,
  zip_code text,
  contact_name text,
  average_lead_days integer check (average_lead_days is null or average_lead_days >= 0),
  payment_terms text,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_id_tenant_key unique (id, tenant_id)
);

create unique index if not exists suppliers_tenant_tax_id_key
  on public.suppliers (tenant_id, tax_id) where tax_id is not null;
create index if not exists suppliers_tenant_name_idx on public.suppliers (tenant_id, legal_name);
create index if not exists suppliers_tenant_active_idx on public.suppliers (tenant_id, active);

-- ============================================================
-- 4. Pedidos de compra
-- ============================================================
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number integer not null,
  supplier_id uuid not null,
  warehouse_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sent', 'partially_received', 'received', 'cancelled')),
  issued_at date not null default current_date,
  expected_at date,
  payment_terms text,
  freight_amount numeric(14, 2) not null default 0 check (freight_amount >= 0),
  discount_amount numeric(14, 2) not null default 0 check (discount_amount >= 0),
  other_amount numeric(14, 2) not null default 0 check (other_amount >= 0),
  items_total numeric(14, 2) not null default 0,
  total_amount numeric(14, 2) not null default 0,
  notes text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancel_reason text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_orders_tenant_number_key unique (tenant_id, number),
  constraint purchase_orders_id_tenant_key unique (id, tenant_id),
  constraint purchase_orders_supplier_tenant_fkey
    foreign key (supplier_id, tenant_id) references public.suppliers (id, tenant_id),
  constraint purchase_orders_warehouse_tenant_fkey
    foreign key (warehouse_id, tenant_id) references public.warehouses (id, tenant_id)
);

create index if not exists purchase_orders_tenant_status_idx
  on public.purchase_orders (tenant_id, status, issued_at desc);
create index if not exists purchase_orders_tenant_supplier_idx
  on public.purchase_orders (tenant_id, supplier_id);
create index if not exists purchase_orders_tenant_expected_idx
  on public.purchase_orders (tenant_id, expected_at);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null,
  product_id uuid not null,
  ordered_qty numeric(14, 3) not null check (ordered_qty > 0),
  received_qty numeric(14, 3) not null default 0 check (received_qty >= 0),
  unit_cost numeric(14, 4) not null default 0 check (unit_cost >= 0),
  discount_amount numeric(14, 2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14, 2) not null default 0 check (tax_amount >= 0),
  line_total numeric(14, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_items_order_product_key unique (purchase_order_id, product_id),
  constraint purchase_order_items_id_tenant_key unique (id, tenant_id),
  constraint purchase_order_items_order_tenant_fkey
    foreign key (purchase_order_id, tenant_id) references public.purchase_orders (id, tenant_id) on delete cascade,
  constraint purchase_order_items_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products (id, tenant_id)
);

create index if not exists purchase_order_items_order_idx
  on public.purchase_order_items (purchase_order_id);
create index if not exists purchase_order_items_tenant_product_idx
  on public.purchase_order_items (tenant_id, product_id);

-- ============================================================
-- 5. Recebimentos
-- ============================================================
create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number integer not null,
  purchase_order_id uuid not null,
  supplier_id uuid not null,
  warehouse_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'reversed')),
  received_at date not null default current_date,
  invoice_number text,
  notes text,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete set null,
  reverse_reason text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goods_receipts_tenant_number_key unique (tenant_id, number),
  constraint goods_receipts_id_tenant_key unique (id, tenant_id),
  constraint goods_receipts_order_tenant_fkey
    foreign key (purchase_order_id, tenant_id) references public.purchase_orders (id, tenant_id),
  constraint goods_receipts_supplier_tenant_fkey
    foreign key (supplier_id, tenant_id) references public.suppliers (id, tenant_id),
  constraint goods_receipts_warehouse_tenant_fkey
    foreign key (warehouse_id, tenant_id) references public.warehouses (id, tenant_id)
);

create index if not exists goods_receipts_tenant_status_idx
  on public.goods_receipts (tenant_id, status, received_at desc);
create index if not exists goods_receipts_order_idx
  on public.goods_receipts (purchase_order_id);

create table if not exists public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  goods_receipt_id uuid not null,
  purchase_order_item_id uuid not null,
  product_id uuid not null,
  accepted_qty numeric(14, 3) not null default 0 check (accepted_qty >= 0),
  rejected_qty numeric(14, 3) not null default 0 check (rejected_qty >= 0),
  unit_cost numeric(14, 4) not null default 0 check (unit_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goods_receipt_items_receipt_item_key unique (goods_receipt_id, purchase_order_item_id),
  constraint goods_receipt_items_qty_check check (accepted_qty > 0 or rejected_qty > 0),
  constraint goods_receipt_items_receipt_tenant_fkey
    foreign key (goods_receipt_id, tenant_id) references public.goods_receipts (id, tenant_id) on delete cascade,
  constraint goods_receipt_items_order_item_tenant_fkey
    foreign key (purchase_order_item_id, tenant_id) references public.purchase_order_items (id, tenant_id),
  constraint goods_receipt_items_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products (id, tenant_id)
);

create index if not exists goods_receipt_items_receipt_idx
  on public.goods_receipt_items (goods_receipt_id);
create index if not exists goods_receipt_items_tenant_product_idx
  on public.goods_receipt_items (tenant_id, product_id);

-- ============================================================
-- 6. Histórico de custo
-- ============================================================
create table if not exists public.product_cost_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  source text not null check (source in ('goods_receipt', 'goods_receipt_reversal', 'manual')),
  reference_id uuid,
  qty numeric(14, 3) not null default 0,
  unit_cost numeric(14, 4) not null default 0,
  previous_average_cost numeric(14, 4),
  new_average_cost numeric(14, 4),
  previous_last_cost numeric(14, 4),
  new_last_cost numeric(14, 4),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint product_cost_history_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products (id, tenant_id) on delete cascade
);

create index if not exists product_cost_history_tenant_product_idx
  on public.product_cost_history (tenant_id, product_id, created_at desc);

-- ============================================================
-- 7. Triggers (numeração sequencial + updated_at)
-- ============================================================
create or replace function private.assign_purchase_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is null or new.number = 0 then
    new.number := private.next_supply_number(new.tenant_id, 'purchase_order');
  end if;
  return new;
end;
$$;

create or replace function private.assign_goods_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is null or new.number = 0 then
    new.number := private.next_supply_number(new.tenant_id, 'goods_receipt');
  end if;
  return new;
end;
$$;

revoke all on function private.assign_purchase_order_number() from public;
revoke all on function private.assign_goods_receipt_number() from public;

alter table public.purchase_orders alter column number set default 0;
alter table public.goods_receipts alter column number set default 0;

drop trigger if exists purchase_orders_number on public.purchase_orders;
create trigger purchase_orders_number before insert on public.purchase_orders
for each row execute function private.assign_purchase_order_number();

drop trigger if exists goods_receipts_number on public.goods_receipts;
create trigger goods_receipts_number before insert on public.goods_receipts
for each row execute function private.assign_goods_receipt_number();

drop trigger if exists suppliers_updated_at on public.suppliers;
create trigger suppliers_updated_at before update on public.suppliers
for each row execute function private.set_updated_at();

drop trigger if exists purchase_orders_updated_at on public.purchase_orders;
create trigger purchase_orders_updated_at before update on public.purchase_orders
for each row execute function private.set_updated_at();

drop trigger if exists purchase_order_items_updated_at on public.purchase_order_items;
create trigger purchase_order_items_updated_at before update on public.purchase_order_items
for each row execute function private.set_updated_at();

drop trigger if exists goods_receipts_updated_at on public.goods_receipts;
create trigger goods_receipts_updated_at before update on public.goods_receipts
for each row execute function private.set_updated_at();

drop trigger if exists goods_receipt_items_updated_at on public.goods_receipt_items;
create trigger goods_receipt_items_updated_at before update on public.goods_receipt_items
for each row execute function private.set_updated_at();

-- ============================================================
-- 8. GRANTs (somente authenticated e service_role; nada para anon)
-- ============================================================
grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_order_items to authenticated;
grant select, insert, update, delete on public.goods_receipts to authenticated;
grant select, insert, update, delete on public.goods_receipt_items to authenticated;
grant select on public.product_cost_history to authenticated;
grant select on public.supply_counters to authenticated;

grant all on public.suppliers to service_role;
grant all on public.purchase_orders to service_role;
grant all on public.purchase_order_items to service_role;
grant all on public.goods_receipts to service_role;
grant all on public.goods_receipt_items to service_role;
grant all on public.product_cost_history to service_role;
grant all on public.supply_counters to service_role;

revoke all on public.suppliers from anon;
revoke all on public.purchase_orders from anon;
revoke all on public.purchase_order_items from anon;
revoke all on public.goods_receipts from anon;
revoke all on public.goods_receipt_items from anon;
revoke all on public.product_cost_history from anon;
revoke all on public.supply_counters from anon;

-- ============================================================
-- 9. RLS: leitura para membros do tenant, escrita para owner/admin/manager/stock
-- ============================================================
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;
alter table public.product_cost_history enable row level security;
alter table public.supply_counters enable row level security;

do $policies$
declare
  target text;
  write_roles text := 'array[''owner'',''admin'',''manager'',''stock'']::text[]';
begin
  foreach target in array array[
    'suppliers', 'purchase_orders', 'purchase_order_items',
    'goods_receipts', 'goods_receipt_items'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', target || '_select_members', target);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.has_tenant_role(tenant_id, null)))',
      target || '_select_members', target);

    execute format('drop policy if exists %I on public.%I', target || '_insert_staff', target);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.has_tenant_role(tenant_id, %s)))',
      target || '_insert_staff', target, write_roles);

    execute format('drop policy if exists %I on public.%I', target || '_update_staff', target);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.has_tenant_role(tenant_id, %s))) with check ((select private.has_tenant_role(tenant_id, %s)))',
      target || '_update_staff', target, write_roles, write_roles);

    execute format('drop policy if exists %I on public.%I', target || '_delete_staff', target);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.has_tenant_role(tenant_id, %s)))',
      target || '_delete_staff', target, write_roles);
  end loop;
end;
$policies$;

drop policy if exists product_cost_history_select_members on public.product_cost_history;
create policy product_cost_history_select_members on public.product_cost_history
for select to authenticated
using ((select private.has_tenant_role(tenant_id, null)));

drop policy if exists supply_counters_select_members on public.supply_counters;
create policy supply_counters_select_members on public.supply_counters
for select to authenticated
using ((select private.has_tenant_role(tenant_id, null)));

-- ============================================================
-- 10. Postagem transacional idempotente do recebimento
-- ============================================================
create or replace function public.confirm_goods_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_receipt public.goods_receipts;
  v_order public.purchase_orders;
  v_item record;
  v_org uuid;
  v_stock_id uuid;
  v_prev_qty numeric;
  v_prev_avg numeric;
  v_prev_last numeric;
  v_new_avg numeric;
  v_total_accepted numeric := 0;
  v_all_received boolean;
  v_any_received boolean;
  v_new_status text;
begin
  if v_user is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_receipt from public.goods_receipts where id = p_receipt_id for update;
  if v_receipt.id is null then
    raise exception 'Recebimento não encontrado';
  end if;

  if not exists (
    select 1 from public.tenant_memberships m
     where m.user_id = v_user
       and m.tenant_id = v_receipt.tenant_id
       and m.active
       and m.role in ('owner', 'admin', 'manager', 'stock')
  ) then
    raise exception 'Usuário sem permissão para confirmar recebimento';
  end if;

  -- idempotência: confirmar de novo não duplica estoque nem custo
  if v_receipt.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already_confirmed', true,
                              'receipt_id', v_receipt.id, 'status', v_receipt.status);
  end if;

  if v_receipt.status <> 'draft' then
    raise exception 'Recebimento com status % não pode ser confirmado', v_receipt.status;
  end if;

  select * into v_order from public.purchase_orders
   where id = v_receipt.purchase_order_id for update;
  if v_order.id is null then
    raise exception 'Pedido de compra não encontrado';
  end if;
  if v_order.status not in ('approved', 'sent', 'partially_received') then
    raise exception 'Pedido de compra com status % não aceita recebimento', v_order.status;
  end if;

  select organization_id into v_org from public.tenants where id = v_receipt.tenant_id;

  for v_item in
    select ri.id as receipt_item_id, ri.product_id, ri.accepted_qty, ri.unit_cost,
           ri.purchase_order_item_id, oi.ordered_qty, oi.received_qty as order_received_qty
      from public.goods_receipt_items ri
      join public.purchase_order_items oi on oi.id = ri.purchase_order_item_id
     where ri.goods_receipt_id = v_receipt.id
     order by ri.id
  loop
    if v_item.accepted_qty + v_item.order_received_qty > v_item.ordered_qty then
      raise exception 'Quantidade recebida acima do saldo pendente do produto %', v_item.product_id;
    end if;

    if v_item.accepted_qty > 0 then
      select id into v_stock_id from public.product_stock
       where tenant_id = v_receipt.tenant_id
         and product_id = v_item.product_id
         and warehouse_id = v_receipt.warehouse_id
       for update;

      if v_stock_id is null then
        insert into public.product_stock (tenant_id, product_id, warehouse_id, on_hand)
        values (v_receipt.tenant_id, v_item.product_id, v_receipt.warehouse_id, v_item.accepted_qty);
      else
        update public.product_stock set on_hand = on_hand + v_item.accepted_qty where id = v_stock_id;
      end if;

      insert into public.stock_movements
        (tenant_id, product_id, warehouse_id, type, qty, reference, notes, user_id)
      values (v_receipt.tenant_id, v_item.product_id, v_receipt.warehouse_id, 'IN',
              v_item.accepted_qty,
              'goods_receipt:' || v_receipt.id::text,
              'Recebimento #' || v_receipt.number::text || ' · pedido #' || v_order.number::text,
              v_user);

      -- custo: último custo de compra + custo médio ponderado por tenant
      select coalesce(sum(ps.on_hand), 0) into v_prev_qty
        from public.product_stock ps
       where ps.tenant_id = v_receipt.tenant_id
         and ps.product_id = v_item.product_id;
      v_prev_qty := greatest(v_prev_qty - v_item.accepted_qty, 0);

      select p.average_cost, p.last_purchase_cost into v_prev_avg, v_prev_last
        from public.products p where p.id = v_item.product_id for update;

      v_new_avg := case
        when v_prev_qty + v_item.accepted_qty <= 0 then v_item.unit_cost
        else ((v_prev_qty * coalesce(v_prev_avg, v_prev_last, v_item.unit_cost))
              + (v_item.accepted_qty * v_item.unit_cost)) / (v_prev_qty + v_item.accepted_qty)
      end;

      update public.products
         set last_purchase_cost = v_item.unit_cost,
             average_cost = v_new_avg,
             last_purchase_at = now()
       where id = v_item.product_id;

      insert into public.product_cost_history
        (tenant_id, product_id, source, reference_id, qty, unit_cost,
         previous_average_cost, new_average_cost, previous_last_cost, new_last_cost, created_by)
      values (v_receipt.tenant_id, v_item.product_id, 'goods_receipt', v_receipt.id,
              v_item.accepted_qty, v_item.unit_cost, v_prev_avg, v_new_avg, v_prev_last,
              v_item.unit_cost, v_user);

      v_total_accepted := v_total_accepted + v_item.accepted_qty;

      update public.purchase_order_items
         set received_qty = received_qty + v_item.accepted_qty
       where id = v_item.purchase_order_item_id;
    end if;
  end loop;

  update public.goods_receipts
     set status = 'confirmed', confirmed_at = now(), confirmed_by = v_user, updated_by = v_user
   where id = v_receipt.id;

  select bool_and(received_qty >= ordered_qty), bool_or(received_qty > 0)
    into v_all_received, v_any_received
    from public.purchase_order_items where purchase_order_id = v_order.id;

  v_new_status := case
    when coalesce(v_all_received, false) then 'received'
    when coalesce(v_any_received, false) then 'partially_received'
    else v_order.status
  end;

  update public.purchase_orders set status = v_new_status, updated_by = v_user where id = v_order.id;

  insert into public.audit_events
    (organization_id, tenant_id, actor_user_id, action, resource_type, resource_id, after_data, metadata)
  values (v_org, v_receipt.tenant_id, v_user, 'goods_receipt.confirmed', 'goods_receipt',
          v_receipt.id::text,
          jsonb_build_object('status', 'confirmed', 'accepted_total', v_total_accepted),
          jsonb_build_object('purchase_order_id', v_order.id, 'order_status', v_new_status));

  return jsonb_build_object('ok', true, 'already_confirmed', false, 'receipt_id', v_receipt.id,
                            'status', 'confirmed', 'accepted_total', v_total_accepted,
                            'purchase_order_status', v_new_status);
end;
$$;

create or replace function public.reverse_goods_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_receipt public.goods_receipts;
  v_order public.purchase_orders;
  v_item record;
  v_org uuid;
  v_stock_id uuid;
  v_all_received boolean;
  v_any_received boolean;
  v_new_status text;
begin
  if v_user is null then
    raise exception 'Não autenticado';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo do estorno';
  end if;

  select * into v_receipt from public.goods_receipts where id = p_receipt_id for update;
  if v_receipt.id is null then
    raise exception 'Recebimento não encontrado';
  end if;

  if not exists (
    select 1 from public.tenant_memberships m
     where m.user_id = v_user
       and m.tenant_id = v_receipt.tenant_id
       and m.active
       and m.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Usuário sem permissão para estornar recebimento';
  end if;

  if v_receipt.status = 'reversed' then
    return jsonb_build_object('ok', true, 'already_reversed', true, 'receipt_id', v_receipt.id);
  end if;
  if v_receipt.status <> 'confirmed' then
    raise exception 'Somente recebimento confirmado pode ser estornado';
  end if;

  select * into v_order from public.purchase_orders where id = v_receipt.purchase_order_id for update;
  select organization_id into v_org from public.tenants where id = v_receipt.tenant_id;

  for v_item in
    select ri.id, ri.product_id, ri.accepted_qty, ri.unit_cost, ri.purchase_order_item_id
      from public.goods_receipt_items ri
     where ri.goods_receipt_id = v_receipt.id
     order by ri.id
  loop
    if v_item.accepted_qty > 0 then
      select id into v_stock_id from public.product_stock
       where tenant_id = v_receipt.tenant_id
         and product_id = v_item.product_id
         and warehouse_id = v_receipt.warehouse_id
       for update;

      if v_stock_id is not null then
        update public.product_stock
           set on_hand = greatest(on_hand - v_item.accepted_qty, 0)
         where id = v_stock_id;
      end if;

      insert into public.stock_movements
        (tenant_id, product_id, warehouse_id, type, qty, reference, notes, user_id)
      values (v_receipt.tenant_id, v_item.product_id, v_receipt.warehouse_id, 'OUT',
              v_item.accepted_qty,
              'goods_receipt_reversal:' || v_receipt.id::text,
              'Estorno do recebimento #' || v_receipt.number::text, v_user);

      insert into public.product_cost_history
        (tenant_id, product_id, source, reference_id, qty, unit_cost, created_by)
      values (v_receipt.tenant_id, v_item.product_id, 'goods_receipt_reversal', v_receipt.id,
              -v_item.accepted_qty, v_item.unit_cost, v_user);

      update public.purchase_order_items
         set received_qty = greatest(received_qty - v_item.accepted_qty, 0)
       where id = v_item.purchase_order_item_id;
    end if;
  end loop;

  update public.goods_receipts
     set status = 'reversed', reversed_at = now(), reversed_by = v_user,
         reverse_reason = p_reason, updated_by = v_user
   where id = v_receipt.id;

  select bool_and(received_qty >= ordered_qty), bool_or(received_qty > 0)
    into v_all_received, v_any_received
    from public.purchase_order_items where purchase_order_id = v_order.id;

  v_new_status := case
    when coalesce(v_all_received, false) then 'received'
    when coalesce(v_any_received, false) then 'partially_received'
    else 'approved'
  end;

  update public.purchase_orders set status = v_new_status, updated_by = v_user where id = v_order.id;

  insert into public.audit_events
    (organization_id, tenant_id, actor_user_id, action, resource_type, resource_id, after_data, metadata)
  values (v_org, v_receipt.tenant_id, v_user, 'goods_receipt.reversed', 'goods_receipt',
          v_receipt.id::text, jsonb_build_object('status', 'reversed'),
          jsonb_build_object('reason', p_reason, 'purchase_order_id', v_order.id,
                             'order_status', v_new_status));

  return jsonb_build_object('ok', true, 'already_reversed', false, 'receipt_id', v_receipt.id,
                            'status', 'reversed', 'purchase_order_status', v_new_status);
end;
$$;

revoke all on function public.confirm_goods_receipt(uuid) from public;
revoke all on function public.confirm_goods_receipt(uuid) from anon;
grant execute on function public.confirm_goods_receipt(uuid) to authenticated;
grant execute on function public.confirm_goods_receipt(uuid) to service_role;

revoke all on function public.reverse_goods_receipt(uuid, text) from public;
revoke all on function public.reverse_goods_receipt(uuid, text) from anon;
grant execute on function public.reverse_goods_receipt(uuid, text) to authenticated;
grant execute on function public.reverse_goods_receipt(uuid, text) to service_role;

commit;
