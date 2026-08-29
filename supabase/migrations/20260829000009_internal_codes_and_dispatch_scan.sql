-- Internal product codes, outbound scan conference and fiscal gate.
-- This migration intentionally keeps writes behind service-role RPCs and RLS.

create sequence if not exists public.product_internal_code_seq;

create unique index if not exists products_tenant_internal_code_unique_idx
  on public.products (tenant_id, upper(btrim(internal_code)))
  where nullif(btrim(internal_code), '') is not null
    and deleted_at is null;

create index if not exists products_tenant_gtin_scan_idx
  on public.products (tenant_id, upper(btrim(gtin)))
  where nullif(btrim(gtin), '') is not null
    and deleted_at is null;

create index if not exists products_tenant_sku_scan_idx
  on public.products (tenant_id, upper(btrim(sku)))
  where nullif(btrim(sku), '') is not null
    and deleted_at is null;

create table if not exists public.order_dispatches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  order_id uuid not null references public.orders(id),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'conferred', 'cancelled')),
  started_at timestamptz,
  started_by uuid,
  started_by_name text,
  completed_at timestamptz,
  completed_by uuid,
  completed_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_id)
);

create table if not exists public.order_dispatch_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  dispatch_id uuid not null references public.order_dispatches(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  product_id uuid not null references public.products(id),
  expected_qty integer not null check (expected_qty > 0),
  scanned_qty integer not null default 0
    check (scanned_qty >= 0 and scanned_qty <= expected_qty),
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dispatch_id, order_item_id)
);

create table if not exists public.order_dispatch_scans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  dispatch_id uuid not null references public.order_dispatches(id) on delete cascade,
  dispatch_item_id uuid not null references public.order_dispatch_items(id) on delete cascade,
  product_id uuid not null references public.products(id),
  scanned_code text not null check (length(btrim(scanned_code)) between 1 and 120),
  quantity integer not null default 1 check (quantity > 0 and quantity <= 100),
  scanner_user_id uuid not null,
  scanner_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_dispatches_tenant_status_idx
  on public.order_dispatches (tenant_id, status, updated_at desc);
create index if not exists order_dispatch_items_dispatch_idx
  on public.order_dispatch_items (tenant_id, dispatch_id, product_id);
create index if not exists order_dispatch_scans_dispatch_idx
  on public.order_dispatch_scans (tenant_id, dispatch_id, created_at desc);

alter table public.order_dispatches enable row level security;
alter table public.order_dispatch_items enable row level security;
alter table public.order_dispatch_scans enable row level security;

drop policy if exists "dispatches_select_tenant_staff" on public.order_dispatches;
create policy "dispatches_select_tenant_staff"
  on public.order_dispatches
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = order_dispatches.tenant_id
        and tm.user_id = (select auth.uid())
        and tm.active
        and tm.role in ('owner', 'admin', 'manager', 'sales', 'stock')
    )
  );

drop policy if exists "dispatch_items_select_tenant_staff" on public.order_dispatch_items;
create policy "dispatch_items_select_tenant_staff"
  on public.order_dispatch_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = order_dispatch_items.tenant_id
        and tm.user_id = (select auth.uid())
        and tm.active
        and tm.role in ('owner', 'admin', 'manager', 'sales', 'stock')
    )
  );

drop policy if exists "dispatch_scans_select_tenant_staff" on public.order_dispatch_scans;
create policy "dispatch_scans_select_tenant_staff"
  on public.order_dispatch_scans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = order_dispatch_scans.tenant_id
        and tm.user_id = (select auth.uid())
        and tm.active
        and tm.role in ('owner', 'admin', 'manager', 'sales', 'stock')
    )
  );

revoke insert, update, delete on table public.order_dispatches from anon, authenticated;
revoke insert, update, delete on table public.order_dispatch_items from anon, authenticated;
revoke insert, update, delete on table public.order_dispatch_scans from anon, authenticated;
grant select on table public.order_dispatches, public.order_dispatch_items, public.order_dispatch_scans to authenticated;
grant all on table public.order_dispatches, public.order_dispatch_items, public.order_dispatch_scans to service_role;

create or replace function private.order_dispatch_payload(p_dispatch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', d.id,
    'order_id', d.order_id,
    'status', d.status,
    'started_at', d.started_at,
    'started_by', d.started_by,
    'started_by_name', d.started_by_name,
    'completed_at', d.completed_at,
    'completed_by', d.completed_by,
    'completed_by_name', d.completed_by_name,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', di.id,
          'order_item_id', di.order_item_id,
          'product_id', di.product_id,
          'expected_qty', di.expected_qty,
          'scanned_qty', di.scanned_qty,
          'last_scanned_at', di.last_scanned_at,
          'name', oi.name,
          'sku', oi.sku,
          'internal_code', p.internal_code,
          'manufacturer_code', p.manufacturer_code,
          'gtin', p.gtin
        )
        order by oi.name, di.id
      )
      from public.order_dispatch_items di
      join public.order_items oi on oi.id = di.order_item_id
      join public.products p on p.id = di.product_id
      where di.dispatch_id = d.id
    ), '[]'::jsonb)
  )
  from public.order_dispatches d
  where d.id = p_dispatch_id;
$function$;

create or replace function public.internal_generate_product_internal_codes(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_limit integer default 200
)
returns table(product_id uuid, internal_code text, name text, sku text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  product_row record;
  candidate text;
  updated_code text;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'tenant and actor are required';
  end if;
  if p_limit < 1 or p_limit > 1000 then
    raise exception 'limit must be between 1 and 1000';
  end if;
  if not exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_actor_user_id
      and tm.active
      and tm.role in ('owner', 'admin', 'manager', 'stock')
  ) then
    raise exception 'actor is not authorized to generate internal codes';
  end if;

  for product_row in
    select p.id, p.name, p.sku
    from public.products p
    where p.tenant_id = p_tenant_id
      and p.deleted_at is null
      and nullif(btrim(p.internal_code), '') is null
    order by p.created_at, p.id
    limit p_limit
    for update
  loop
    loop
      candidate := 'NS' || lpad(nextval('public.product_internal_code_seq')::text, 8, '0');
      begin
        update public.products p
        set internal_code = candidate, updated_at = now()
        where p.id = product_row.id
          and p.tenant_id = p_tenant_id
          and p.deleted_at is null
          and nullif(btrim(p.internal_code), '') is null
        returning p.internal_code into updated_code;

        if updated_code is not null then
          product_id := product_row.id;
          internal_code := updated_code;
          name := product_row.name;
          sku := product_row.sku;
          return next;
          exit;
        end if;
        exit;
      exception
        when unique_violation then
          continue;
      end;
    end loop;
  end loop;
end;
$function$;

create or replace function public.internal_start_order_dispatch(
  p_order_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
  v_dispatch public.order_dispatches%rowtype;
  v_actor_name text;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_order_id is null or p_actor_user_id is null then
    raise exception 'order and actor are required';
  end if;

  select o.*
  into v_order
  from public.orders o
  where o.id = p_order_id
    and o.deleted_at is null
  for update;

  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  if v_order.status::text not in ('pago', 'faturado', 'enviado') then
    raise exception 'A conferência só pode começar para pedido pago ou faturado';
  end if;
  if not exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = v_order.tenant_id
      and tm.user_id = p_actor_user_id
      and tm.active
      and tm.role in ('owner', 'admin', 'manager', 'stock')
  ) then
    raise exception 'Usuário sem permissão para conferir saída';
  end if;
  if exists (
    select 1 from public.order_items oi
    where oi.order_id = v_order.id
      and oi.tenant_id = v_order.tenant_id
      and oi.product_id is null
  ) then
    raise exception 'Há item do pedido sem produto vinculado; corrija antes de conferir';
  end if;
  if not exists (select 1 from public.order_items oi where oi.order_id = v_order.id) then
    raise exception 'Pedido sem itens';
  end if;

  select p.full_name
  into v_actor_name
  from public.profiles p
  where p.id = p_actor_user_id;
  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), 'Usuário da operação');

  select d.*
  into v_dispatch
  from public.order_dispatches d
  where d.tenant_id = v_order.tenant_id
    and d.order_id = v_order.id
  for update;

  if found then
    if v_dispatch.status = 'cancelled' then
      raise exception 'A conferência deste pedido foi cancelada';
    end if;
    return private.order_dispatch_payload(v_dispatch.id);
  end if;

  insert into public.order_dispatches (
    tenant_id, order_id, status, started_at, started_by, started_by_name
  )
  values (
    v_order.tenant_id, v_order.id, 'in_progress', now(), p_actor_user_id, v_actor_name
  )
  returning * into v_dispatch;

  insert into public.order_dispatch_items (
    tenant_id, dispatch_id, order_item_id, product_id, expected_qty
  )
  select v_order.tenant_id, v_dispatch.id, oi.id, oi.product_id, oi.quantity
  from public.order_items oi
  where oi.order_id = v_order.id
    and oi.tenant_id = v_order.tenant_id
  order by oi.id;

  update public.shipments s
  set status = case
                 when s.status in ('aguardando_separacao', 'em_separacao')
                   then 'aguardando_conferencia'
                 else s.status
               end,
      picker_user_id = coalesce(s.picker_user_id, p_actor_user_id),
      picked_at = coalesce(s.picked_at, now()),
      updated_at = now()
  where s.tenant_id = v_order.tenant_id
    and s.order_id = v_order.id
    and s.status not in ('cancelado', 'entregue');

  return private.order_dispatch_payload(v_dispatch.id);
end;
$function$;

create or replace function public.internal_scan_order_dispatch(
  p_dispatch_id uuid,
  p_code text,
  p_quantity integer default 1,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_dispatch public.order_dispatches%rowtype;
  v_product public.products%rowtype;
  v_item public.order_dispatch_items%rowtype;
  v_actor_name text;
  v_code text;
  v_matches integer;
  v_new_qty integer;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_dispatch_id is null or p_actor_user_id is null then
    raise exception 'dispatch and actor are required';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'A quantidade deve ficar entre 1 e 100';
  end if;

  v_code := upper(btrim(coalesce(p_code, '')));
  if length(v_code) < 1 or length(v_code) > 120 then
    raise exception 'Informe um código válido';
  end if;

  select d.*
  into v_dispatch
  from public.order_dispatches d
  where d.id = p_dispatch_id
  for update;
  if not found then
    raise exception 'Conferência não encontrada';
  end if;
  if v_dispatch.status in ('cancelled', 'conferred') then
    raise exception 'Esta conferência já foi encerrada';
  end if;
  if not exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = v_dispatch.tenant_id
      and tm.user_id = p_actor_user_id
      and tm.active
      and tm.role in ('owner', 'admin', 'manager', 'stock')
  ) then
    raise exception 'Usuário sem permissão para conferir saída';
  end if;

  select count(*)
  into v_matches
  from public.products p
  where p.tenant_id = v_dispatch.tenant_id
    and p.deleted_at is null
    and (
      upper(btrim(coalesce(p.internal_code, ''))) = v_code
      or upper(btrim(coalesce(p.sku, ''))) = v_code
      or upper(btrim(coalesce(p.gtin, ''))) = v_code
      or upper(btrim(coalesce(p.manufacturer_code, ''))) = v_code
    );

  if v_matches = 0 then
    raise exception 'Código "%" não encontrado no catálogo desta empresa', v_code;
  end if;
  if v_matches > 1 then
    raise exception 'Código "%" corresponde a mais de um produto; use o código interno', v_code;
  end if;

  select p.*
  into v_product
  from public.products p
  where p.tenant_id = v_dispatch.tenant_id
    and p.deleted_at is null
    and (
      upper(btrim(coalesce(p.internal_code, ''))) = v_code
      or upper(btrim(coalesce(p.sku, ''))) = v_code
      or upper(btrim(coalesce(p.gtin, ''))) = v_code
      or upper(btrim(coalesce(p.manufacturer_code, ''))) = v_code
    );

  select di.*
  into v_item
  from public.order_dispatch_items di
  where di.dispatch_id = v_dispatch.id
    and di.product_id = v_product.id
    and di.scanned_qty < di.expected_qty
  order by di.id
  limit 1
  for update;

  if not found then
    if exists (
      select 1
      from public.order_dispatch_items di
      where di.dispatch_id = v_dispatch.id
        and di.product_id = v_product.id
    ) then
      raise exception 'Produto "%" já foi conferido na quantidade do pedido', v_product.name;
    end if;
    raise exception 'Produto "%" não pertence a este pedido', v_product.name;
  end if;

  v_new_qty := v_item.scanned_qty + p_quantity;
  if v_new_qty > v_item.expected_qty then
    raise exception 'Quantidade excedente para "%": faltam apenas % unidade(s)', v_product.name, v_item.expected_qty - v_item.scanned_qty;
  end if;

  select p.full_name
  into v_actor_name
  from public.profiles p
  where p.id = p_actor_user_id;
  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), 'Usuário da operação');

  update public.order_dispatch_items di
  set scanned_qty = v_new_qty,
      last_scanned_at = now(),
      updated_at = now()
  where di.id = v_item.id;

  insert into public.order_dispatch_scans (
    tenant_id, dispatch_id, dispatch_item_id, product_id,
    scanned_code, quantity, scanner_user_id, scanner_name
  )
  values (
    v_dispatch.tenant_id, v_dispatch.id, v_item.id, v_product.id,
    v_code, p_quantity, p_actor_user_id, v_actor_name
  );

  update public.order_dispatches d
  set status = 'in_progress',
      started_at = coalesce(d.started_at, now()),
      started_by = coalesce(d.started_by, p_actor_user_id),
      started_by_name = coalesce(d.started_by_name, v_actor_name),
      updated_at = now()
  where d.id = v_dispatch.id;

  return jsonb_build_object(
    'dispatch_id', v_dispatch.id,
    'product_id', v_product.id,
    'name', v_product.name,
    'code', v_code,
    'scanned_qty', v_new_qty,
    'expected_qty', v_item.expected_qty,
    'remaining_qty', v_item.expected_qty - v_new_qty,
    'scanner_name', v_actor_name
  );
end;
$function$;

create or replace function public.internal_complete_order_dispatch(
  p_dispatch_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_dispatch public.order_dispatches%rowtype;
  v_actor_name text;
  v_missing integer;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_dispatch_id is null or p_actor_user_id is null then
    raise exception 'dispatch and actor are required';
  end if;

  select d.*
  into v_dispatch
  from public.order_dispatches d
  where d.id = p_dispatch_id
  for update;
  if not found then
    raise exception 'Conferência não encontrada';
  end if;
  if v_dispatch.status = 'cancelled' then
    raise exception 'Esta conferência foi cancelada';
  end if;
  if not exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = v_dispatch.tenant_id
      and tm.user_id = p_actor_user_id
      and tm.active
      and tm.role in ('owner', 'admin', 'manager', 'stock')
  ) then
    raise exception 'Usuário sem permissão para concluir a conferência';
  end if;

  select count(*)
  into v_missing
  from public.order_dispatch_items di
  where di.dispatch_id = v_dispatch.id
    and di.scanned_qty <> di.expected_qty;
  if v_missing > 0 then
    raise exception 'Ainda faltam itens para conferir (% linha(s))', v_missing;
  end if;

  select p.full_name
  into v_actor_name
  from public.profiles p
  where p.id = p_actor_user_id;
  v_actor_name := coalesce(nullif(btrim(v_actor_name), ''), 'Usuário da operação');

  update public.order_dispatches d
  set status = 'conferred',
      completed_at = coalesce(d.completed_at, now()),
      completed_by = coalesce(d.completed_by, p_actor_user_id),
      completed_by_name = coalesce(d.completed_by_name, v_actor_name),
      updated_at = now()
  where d.id = v_dispatch.id;

  update public.shipments s
  set status = case
                 when s.status in ('cancelado', 'entregue') then s.status
                 else 'pronto_envio'
               end,
      checker_user_id = case
                          when s.status in ('cancelado', 'entregue') then s.checker_user_id
                          else p_actor_user_id
                        end,
      checked_at = case
                     when s.status in ('cancelado', 'entregue') then s.checked_at
                     else now()
                   end,
      updated_at = now()
  where s.tenant_id = v_dispatch.tenant_id
    and s.order_id = v_dispatch.order_id;

  return private.order_dispatch_payload(v_dispatch.id);
end;
$function$;

create or replace function public.enforce_fiscal_dispatch_conference()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.order_id is not null
     and not exists (
       select 1
       from public.order_dispatches d
       where d.tenant_id = new.tenant_id
         and d.order_id = new.order_id
         and d.status = 'conferred'
     ) then
    raise exception 'Conferência de saída obrigatória antes da emissão da NF';
  end if;
  return new;
end;
$function$;

drop trigger if exists fiscal_documents_require_dispatch on public.fiscal_documents;
create trigger fiscal_documents_require_dispatch
  before insert on public.fiscal_documents
  for each row
  execute function public.enforce_fiscal_dispatch_conference();

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
  if p_actor_user_id is null then
    raise exception 'authenticated actor is required';
  end if;

  select current_order.*
  into sale
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
  )
  into actor_allowed;

  if not actor_allowed then
    raise exception 'order operation is not authorized';
  end if;

  if sale.status = p_next_status then
    return sale.status;
  end if;

  if p_next_status = 'faturado'::public.order_status
     and not exists (
       select 1
       from public.order_dispatches d
       where d.tenant_id = sale.tenant_id
         and d.order_id = sale.id
         and d.status = 'conferred'
     ) then
    raise exception 'Conferência de saída obrigatória antes de faturar o pedido';
  end if;

  if not (
    (sale.status = 'pago'::public.order_status and p_next_status = 'faturado'::public.order_status)
    or (sale.status = 'faturado'::public.order_status and p_next_status = 'enviado'::public.order_status)
    or (sale.status = 'enviado'::public.order_status and p_next_status = 'entregue'::public.order_status)
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

revoke all on function private.order_dispatch_payload(uuid) from public, anon, authenticated;
revoke all on function public.internal_generate_product_internal_codes(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.internal_start_order_dispatch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.internal_scan_order_dispatch(uuid, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.internal_complete_order_dispatch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.enforce_fiscal_dispatch_conference() from public, anon, authenticated;
grant execute on function public.internal_generate_product_internal_codes(uuid, uuid, integer) to service_role;
grant execute on function public.internal_start_order_dispatch(uuid, uuid) to service_role;
grant execute on function public.internal_scan_order_dispatch(uuid, text, integer, uuid) to service_role;
grant execute on function public.internal_complete_order_dispatch(uuid, uuid) to service_role;
