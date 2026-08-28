begin;

create table if not exists public.inventory_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid,
  warehouse_id uuid not null,
  return_type text not null check (return_type in ('customer_return','exchange','supplier_return','defective')),
  status text not null default 'completed' check (status in ('completed','cancelled')),
  idempotency_key uuid not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_returns_id_tenant_key unique (id, tenant_id),
  constraint inventory_returns_idempotency_key unique (tenant_id, idempotency_key),
  constraint inventory_returns_order_tenant_fkey
    foreign key (order_id, tenant_id) references public.orders(id, tenant_id) on delete set null,
  constraint inventory_returns_warehouse_tenant_fkey
    foreign key (warehouse_id, tenant_id) references public.warehouses(id, tenant_id)
);

create table if not exists public.inventory_return_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_id uuid not null,
  order_item_id uuid,
  returned_product_id uuid not null,
  replacement_product_id uuid,
  returned_qty integer not null check (returned_qty > 0),
  replacement_qty integer not null default 0 check (replacement_qty >= 0),
  condition text not null check (condition in ('resalable','defective','quarantine')),
  resolution text not null check (resolution in ('restock','replace','quarantine','supplier_return','discard')),
  created_at timestamptz not null default now(),
  constraint inventory_return_items_id_tenant_key unique (id, tenant_id),
  constraint inventory_return_items_return_tenant_fkey
    foreign key (return_id, tenant_id) references public.inventory_returns(id, tenant_id) on delete cascade,
  constraint inventory_return_items_returned_product_tenant_fkey
    foreign key (returned_product_id, tenant_id) references public.products(id, tenant_id),
  constraint inventory_return_items_replacement_product_tenant_fkey
    foreign key (replacement_product_id, tenant_id) references public.products(id, tenant_id),
  constraint inventory_return_items_replacement_pair_check
    check ((replacement_product_id is null and replacement_qty = 0)
      or (replacement_product_id is not null and replacement_qty > 0))
);

create table if not exists public.inventory_quarantine (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  return_id uuid not null,
  return_item_id uuid not null,
  product_id uuid not null,
  warehouse_id uuid not null,
  quantity integer not null check (quantity > 0),
  status text not null default 'pending' check (status in ('pending','released','discarded')),
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint inventory_quarantine_return_tenant_fkey
    foreign key (return_id, tenant_id) references public.inventory_returns(id, tenant_id) on delete cascade,
  constraint inventory_quarantine_item_tenant_fkey
    foreign key (return_item_id, tenant_id) references public.inventory_return_items(id, tenant_id) on delete cascade,
  constraint inventory_quarantine_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products(id, tenant_id),
  constraint inventory_quarantine_warehouse_tenant_fkey
    foreign key (warehouse_id, tenant_id) references public.warehouses(id, tenant_id)
);

create index if not exists inventory_returns_tenant_created_idx
  on public.inventory_returns(tenant_id, created_at desc);
create index if not exists inventory_returns_order_idx
  on public.inventory_returns(tenant_id, order_id);
create index if not exists inventory_return_items_return_idx
  on public.inventory_return_items(tenant_id, return_id);
create index if not exists inventory_quarantine_pending_idx
  on public.inventory_quarantine(tenant_id, status, created_at desc);

alter table public.inventory_returns enable row level security;
alter table public.inventory_return_items enable row level security;
alter table public.inventory_quarantine enable row level security;

revoke all on public.inventory_returns, public.inventory_return_items, public.inventory_quarantine
  from public, anon;
grant select on public.inventory_returns, public.inventory_return_items, public.inventory_quarantine
  to authenticated;
grant all on public.inventory_returns, public.inventory_return_items, public.inventory_quarantine
  to service_role;

drop policy if exists inventory_returns_staff_read on public.inventory_returns;
create policy inventory_returns_staff_read on public.inventory_returns
for select to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]));

drop policy if exists inventory_return_items_staff_read on public.inventory_return_items;
create policy inventory_return_items_staff_read on public.inventory_return_items
for select to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]));

drop policy if exists inventory_quarantine_staff_read on public.inventory_quarantine;
create policy inventory_quarantine_staff_read on public.inventory_quarantine
for select to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]));

create or replace function private.touch_inventory_return_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.touch_inventory_return_updated_at() from public, anon, authenticated;

drop trigger if exists inventory_returns_touch_updated_at on public.inventory_returns;
create trigger inventory_returns_touch_updated_at
before update on public.inventory_returns
for each row execute function private.touch_inventory_return_updated_at();

create or replace function public.record_inventory_return(
  p_tenant_id uuid,
  p_return_type text,
  p_warehouse_id uuid,
  p_reason text,
  p_items jsonb,
  p_user_id uuid,
  p_order_id uuid default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return_id uuid;
  v_existing_status text;
  v_item jsonb;
  v_item_id uuid;
  v_returned_product_id uuid;
  v_replacement_product_id uuid;
  v_returned_qty integer;
  v_replacement_qty integer;
  v_condition text;
  v_resolution text;
  v_order_item_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_tenant_id is null or p_warehouse_id is null or p_user_id is null then
    raise exception 'tenant, depósito e operador são obrigatórios';
  end if;
  if p_return_type is null or p_return_type not in ('customer_return','exchange','supplier_return','defective') then
    raise exception 'tipo de devolução inválido';
  end if;
  if p_reason is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 3 and 1000 then
    raise exception 'motivo deve ter entre 3 e 1.000 caracteres';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0
     or pg_catalog.jsonb_array_length(p_items) > 100 then
    raise exception 'informe entre 1 e 100 itens';
  end if;
  if not exists (
    select 1 from public.warehouses
    where id = p_warehouse_id and tenant_id = p_tenant_id and active
  ) then
    raise exception 'depósito não pertence ao ambiente ou está inativo';
  end if;
  if p_order_id is not null and not exists (
    select 1 from public.orders
    where id = p_order_id and tenant_id = p_tenant_id
  ) then
    raise exception 'pedido não pertence ao ambiente';
  end if;

  insert into public.inventory_returns (
    tenant_id, order_id, warehouse_id, return_type, reason, notes,
    idempotency_key, created_by, completed_by, completed_at
  )
  values (
    p_tenant_id, p_order_id, p_warehouse_id, p_return_type,
    pg_catalog.btrim(p_reason),
    nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_notes, '')), 2000), ''),
    p_idempotency_key, p_user_id, p_user_id, pg_catalog.now()
  )
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into v_return_id;

  if v_return_id is null then
    select id, status into v_return_id, v_existing_status
    from public.inventory_returns
    where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key
    for update;
    if v_existing_status = 'completed' then
      return v_return_id;
    end if;
    raise exception 'operação de devolução já existe e não pode ser reaplicada';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_items)
  loop
    v_returned_product_id := (v_item->>'returned_product_id')::uuid;
    v_replacement_product_id := nullif(v_item->>'replacement_product_id', '')::uuid;
    v_returned_qty := (v_item->>'returned_qty')::integer;
    v_replacement_qty := coalesce(nullif(v_item->>'replacement_qty', '')::integer, 0);
    v_condition := coalesce(v_item->>'condition', '');
    v_resolution := coalesce(v_item->>'resolution', '');
    v_order_item_id := nullif(v_item->>'order_item_id', '')::uuid;

    if v_returned_qty is null or v_returned_qty <= 0 then
      raise exception 'quantidade devolvida inválida';
    end if;
    if v_replacement_qty < 0 then
      raise exception 'quantidade substituta inválida';
    end if;
    if v_condition not in ('resalable','defective','quarantine')
       or v_resolution not in ('restock','replace','quarantine','supplier_return','discard') then
      raise exception 'condição ou destino do item inválido';
    end if;
    if v_replacement_qty > 0 and v_replacement_product_id is null then
      raise exception 'produto substituto é obrigatório quando houver quantidade substituta';
    end if;
    if v_replacement_qty = 0 and v_replacement_product_id is not null then
      raise exception 'quantidade substituta é obrigatória para o produto substituto';
    end if;
    if p_return_type = 'exchange' and (v_replacement_product_id is null or v_replacement_qty = 0) then
      raise exception 'troca exige produto e quantidade substitutos';
    end if;
    if p_return_type <> 'exchange' and v_replacement_qty > 0 then
      raise exception 'produto substituto só pode ser informado em uma troca';
    end if;
    if v_order_item_id is not null and not exists (
      select 1 from public.order_items
      where id = v_order_item_id and tenant_id = p_tenant_id
        and (p_order_id is null or order_id = p_order_id)
    ) then
      raise exception 'item do pedido não pertence ao ambiente ou ao pedido informado';
    end if;
    if not exists (
      select 1 from public.products
      where id = v_returned_product_id and tenant_id = p_tenant_id
    ) then
      raise exception 'produto devolvido não pertence ao ambiente';
    end if;
    if v_replacement_product_id is not null and not exists (
      select 1 from public.products
      where id = v_replacement_product_id and tenant_id = p_tenant_id
    ) then
      raise exception 'produto substituto não pertence ao ambiente';
    end if;

    insert into public.inventory_return_items (
      tenant_id, return_id, order_item_id, returned_product_id, replacement_product_id,
      returned_qty, replacement_qty, condition, resolution
    )
    values (
      p_tenant_id, v_return_id, v_order_item_id, v_returned_product_id, v_replacement_product_id,
      v_returned_qty, v_replacement_qty, v_condition, v_resolution
    )
    returning id into v_item_id;

    if p_return_type = 'supplier_return' or v_resolution = 'supplier_return' then
      perform public.adjust_product_stock(
        p_tenant_id, v_returned_product_id, p_warehouse_id, 'OUT', v_returned_qty,
        'RETURN:' || v_return_id::text, 'Devolução para fornecedor', p_user_id
      );
    elsif p_return_type = 'defective' then
      insert into public.inventory_quarantine (
        tenant_id, return_id, return_item_id, product_id, warehouse_id, quantity, reason, created_by
      )
      values (
        p_tenant_id, v_return_id, v_item_id, v_returned_product_id, p_warehouse_id,
        v_returned_qty, 'Produto devolvido como defeituoso', p_user_id
      );
    elsif v_condition = 'resalable' and v_resolution in ('restock','replace') then
      perform public.adjust_product_stock(
        p_tenant_id, v_returned_product_id, p_warehouse_id, 'IN', v_returned_qty,
        'RETURN:' || v_return_id::text, 'Devolução aprovada para revenda', p_user_id
      );
    elsif v_resolution = 'quarantine' or v_condition in ('defective','quarantine') then
      insert into public.inventory_quarantine (
        tenant_id, return_id, return_item_id, product_id, warehouse_id, quantity, reason, created_by
      )
      values (
        p_tenant_id, v_return_id, v_item_id, v_returned_product_id, p_warehouse_id,
        v_returned_qty, 'Aguardando avaliação de qualidade', p_user_id
      );
    end if;

    if v_replacement_product_id is not null and v_replacement_qty > 0 then
      perform public.adjust_product_stock(
        p_tenant_id, v_replacement_product_id, p_warehouse_id, 'OUT', v_replacement_qty,
        'RETURN:' || v_return_id::text, 'Produto substituto entregue', p_user_id
      );
    end if;
  end loop;

  update public.inventory_returns
  set status = 'completed',
      completed_by = p_user_id,
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = v_return_id and tenant_id = p_tenant_id;

  return v_return_id;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'dados dos itens da devolução são inválidos';
end;
$$;

revoke all on function public.record_inventory_return(uuid, text, uuid, text, jsonb, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_inventory_return(uuid, text, uuid, text, jsonb, uuid, uuid, text, uuid)
  to service_role;

comment on function public.record_inventory_return(uuid, text, uuid, text, jsonb, uuid, uuid, text, uuid)
  is 'Registra devoluções e trocas com estoque atômico, substituição e quarentena auditável.';

commit;