-- Importação e conferência de XML de NF-e de compra (Suprimentos).
--
-- Este projeto DEV usa Supabase externo (pleuoxzocgoajmymipqi): aplique este
-- arquivo manualmente no SQL Editor, como os demais em supabase/manual/.
-- Idempotente: pode ser reexecutado sem efeitos destrutivos.
--
-- Escopo desta etapa: importar XML, conferir itens, vincular produtos e gerar
-- recebimento em rascunho. Manifestação do destinatário, download automático
-- na SEFAZ e escrituração fiscal ficam explicitamente como evolução futura.

begin;

-- ============================================================
-- 1. GTIN no produto (usado no vínculo automático do item da NF-e)
-- ============================================================
alter table public.products
  add column if not exists gtin text;

create index if not exists products_tenant_gtin_idx
  on public.products (tenant_id, gtin) where gtin is not null;

-- ============================================================
-- 2. Recebimento sem pedido de compra (entrada avulsa por NF-e)
-- ============================================================
alter table public.goods_receipts
  alter column purchase_order_id drop not null;

alter table public.goods_receipts
  add column if not exists no_order_reason text;

alter table public.goods_receipt_items
  alter column purchase_order_item_id drop not null;

-- unicidade por item do pedido só se existir pedido; sem pedido, um produto por recebimento
alter table public.goods_receipt_items
  drop constraint if exists goods_receipt_items_receipt_item_key;

create unique index if not exists goods_receipt_items_receipt_order_item_key
  on public.goods_receipt_items (goods_receipt_id, purchase_order_item_id)
  where purchase_order_item_id is not null;

create unique index if not exists goods_receipt_items_receipt_product_key
  on public.goods_receipt_items (goods_receipt_id, product_id)
  where purchase_order_item_id is null;

-- ============================================================
-- 3. Códigos de produto por fornecedor (aprendizado do vínculo manual)
-- ============================================================
create table if not exists public.supplier_product_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_id uuid not null,
  supplier_code text not null,
  product_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_product_codes_key unique (tenant_id, supplier_id, supplier_code),
  constraint supplier_product_codes_supplier_tenant_fkey
    foreign key (supplier_id, tenant_id) references public.suppliers (id, tenant_id) on delete cascade,
  constraint supplier_product_codes_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products (id, tenant_id) on delete cascade
);

create index if not exists supplier_product_codes_product_idx
  on public.supplier_product_codes (tenant_id, product_id);

-- ============================================================
-- 4. NF-e importadas (metadados de auditoria)
-- ============================================================
create table if not exists public.nfe_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  access_key text not null check (access_key ~ '^[0-9]{44}$'),
  file_hash text not null,
  file_name text,
  file_size integer,
  nfe_version text,
  nfe_number integer,
  nfe_series integer,
  nfe_model text,
  operation_nature text,
  issued_at timestamptz,
  entered_at timestamptz,
  emitter_tax_id text not null,
  emitter_name text,
  emitter_trade_name text,
  emitter_state_tax_id text,
  emitter_address jsonb not null default '{}'::jsonb,
  recipient_tax_id text,
  recipient_name text,
  total_products numeric(14, 2) not null default 0,
  total_discount numeric(14, 2) not null default 0,
  total_freight numeric(14, 2) not null default 0,
  total_invoice numeric(14, 2) not null default 0,
  items_count integer not null default 0,
  supplier_id uuid,
  purchase_order_id uuid,
  warehouse_id uuid,
  goods_receipt_id uuid,
  no_order_reason text,
  status text not null default 'importado'
    check (status in ('importado', 'em_conferencia', 'divergente', 'pronto', 'confirmado', 'cancelado')),
  cancel_reason text,
  divergences jsonb not null default '[]'::jsonb,
  raw_xml text,
  imported_by uuid references auth.users(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_imports_tenant_key_unique unique (tenant_id, access_key),
  constraint nfe_imports_id_tenant_key unique (id, tenant_id),
  constraint nfe_imports_supplier_tenant_fkey
    foreign key (supplier_id, tenant_id) references public.suppliers (id, tenant_id),
  constraint nfe_imports_order_tenant_fkey
    foreign key (purchase_order_id, tenant_id) references public.purchase_orders (id, tenant_id),
  constraint nfe_imports_warehouse_tenant_fkey
    foreign key (warehouse_id, tenant_id) references public.warehouses (id, tenant_id),
  constraint nfe_imports_receipt_tenant_fkey
    foreign key (goods_receipt_id, tenant_id) references public.goods_receipts (id, tenant_id)
);

create unique index if not exists nfe_imports_tenant_file_hash_key
  on public.nfe_imports (tenant_id, file_hash);
create index if not exists nfe_imports_tenant_status_idx
  on public.nfe_imports (tenant_id, status, created_at desc);
create index if not exists nfe_imports_tenant_emitter_idx
  on public.nfe_imports (tenant_id, emitter_tax_id);
create index if not exists nfe_imports_tenant_receipt_idx
  on public.nfe_imports (tenant_id, goods_receipt_id);

create table if not exists public.nfe_import_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nfe_import_id uuid not null,
  line_number integer not null,
  supplier_code text,
  gtin text,
  description text not null,
  ncm text,
  cfop text,
  unit text,
  qty numeric(14, 4) not null default 0,
  unit_value numeric(14, 6) not null default 0,
  discount_amount numeric(14, 2) not null default 0,
  freight_amount numeric(14, 2) not null default 0,
  other_amount numeric(14, 2) not null default 0,
  total_amount numeric(14, 2) not null default 0,
  product_id uuid,
  purchase_order_item_id uuid,
  match_source text not null default 'none'
    check (match_source in ('none', 'gtin', 'manufacturer_code', 'sku', 'internal_code', 'supplier_code', 'manual')),
  match_confidence text not null default 'pendente'
    check (match_confidence in ('alta', 'media', 'baixa', 'pendente')),
  divergences jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_import_items_line_key unique (nfe_import_id, line_number),
  constraint nfe_import_items_id_tenant_key unique (id, tenant_id),
  constraint nfe_import_items_import_tenant_fkey
    foreign key (nfe_import_id, tenant_id) references public.nfe_imports (id, tenant_id) on delete cascade,
  constraint nfe_import_items_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products (id, tenant_id),
  constraint nfe_import_items_order_item_tenant_fkey
    foreign key (purchase_order_item_id, tenant_id) references public.purchase_order_items (id, tenant_id)
);

create index if not exists nfe_import_items_import_idx
  on public.nfe_import_items (nfe_import_id, line_number);
create index if not exists nfe_import_items_tenant_product_idx
  on public.nfe_import_items (tenant_id, product_id);

-- ============================================================
-- 5. Triggers de updated_at
-- ============================================================
drop trigger if exists supplier_product_codes_updated_at on public.supplier_product_codes;
create trigger supplier_product_codes_updated_at before update on public.supplier_product_codes
for each row execute function private.set_updated_at();

drop trigger if exists nfe_imports_updated_at on public.nfe_imports;
create trigger nfe_imports_updated_at before update on public.nfe_imports
for each row execute function private.set_updated_at();

drop trigger if exists nfe_import_items_updated_at on public.nfe_import_items;
create trigger nfe_import_items_updated_at before update on public.nfe_import_items
for each row execute function private.set_updated_at();

-- ============================================================
-- 6. GRANTs (nada para anon)
-- ============================================================
grant select, insert, update, delete on public.nfe_imports to authenticated;
grant select, insert, update, delete on public.nfe_import_items to authenticated;
grant select, insert, update, delete on public.supplier_product_codes to authenticated;

grant all on public.nfe_imports to service_role;
grant all on public.nfe_import_items to service_role;
grant all on public.supplier_product_codes to service_role;

revoke all on public.nfe_imports from anon;
revoke all on public.nfe_import_items from anon;
revoke all on public.supplier_product_codes from anon;

-- ============================================================
-- 7. RLS: leitura para membros; escrita para owner/admin/manager/stock
-- ============================================================
alter table public.nfe_imports enable row level security;
alter table public.nfe_import_items enable row level security;
alter table public.supplier_product_codes enable row level security;

do $policies$
declare
  target text;
  write_roles text := 'array[''owner'',''admin'',''manager'',''stock'']::text[]';
begin
  foreach target in array array['nfe_imports', 'nfe_import_items', 'supplier_product_codes']
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

-- ============================================================
-- 8. confirm_goods_receipt: aceita recebimento sem pedido de compra
--    (mesma regra transacional de estoque/custo; única fonte de verdade)
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
  v_reference text;
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

  if v_receipt.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already_confirmed', true,
                              'receipt_id', v_receipt.id, 'status', v_receipt.status);
  end if;

  if v_receipt.status <> 'draft' then
    raise exception 'Recebimento com status % não pode ser confirmado', v_receipt.status;
  end if;

  if v_receipt.purchase_order_id is not null then
    select * into v_order from public.purchase_orders
     where id = v_receipt.purchase_order_id for update;
    if v_order.id is null then
      raise exception 'Pedido de compra não encontrado';
    end if;
    if v_order.status not in ('approved', 'sent', 'partially_received') then
      raise exception 'Pedido de compra com status % não aceita recebimento', v_order.status;
    end if;
  elsif coalesce(btrim(v_receipt.no_order_reason), '') = '' then
    raise exception 'Recebimento sem pedido de compra exige justificativa';
  end if;

  select organization_id into v_org from public.tenants where id = v_receipt.tenant_id;

  for v_item in
    select ri.id as receipt_item_id, ri.product_id, ri.accepted_qty, ri.unit_cost,
           ri.purchase_order_item_id, oi.ordered_qty, oi.received_qty as order_received_qty
      from public.goods_receipt_items ri
      left join public.purchase_order_items oi on oi.id = ri.purchase_order_item_id
     where ri.goods_receipt_id = v_receipt.id
     order by ri.id
  loop
    if v_item.purchase_order_item_id is not null
       and v_item.accepted_qty + v_item.order_received_qty > v_item.ordered_qty then
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

      v_reference := 'goods_receipt:' || v_receipt.id::text;

      insert into public.stock_movements
        (tenant_id, product_id, warehouse_id, type, qty, reference, notes, user_id)
      values (v_receipt.tenant_id, v_item.product_id, v_receipt.warehouse_id, 'IN',
              v_item.accepted_qty, v_reference,
              'Recebimento #' || v_receipt.number::text ||
              coalesce(' · pedido #' || v_order.number::text, ' · sem pedido'),
              v_user);

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

      if v_item.purchase_order_item_id is not null then
        update public.purchase_order_items
           set received_qty = received_qty + v_item.accepted_qty
         where id = v_item.purchase_order_item_id;
      end if;
    end if;
  end loop;

  update public.goods_receipts
     set status = 'confirmed', confirmed_at = now(), confirmed_by = v_user, updated_by = v_user
   where id = v_receipt.id;

  if v_order.id is not null then
    select bool_and(received_qty >= ordered_qty), bool_or(received_qty > 0)
      into v_all_received, v_any_received
      from public.purchase_order_items where purchase_order_id = v_order.id;

    v_new_status := case
      when coalesce(v_all_received, false) then 'received'
      when coalesce(v_any_received, false) then 'partially_received'
      else v_order.status
    end;

    update public.purchase_orders set status = v_new_status, updated_by = v_user where id = v_order.id;
  end if;

  -- NF-e vinculada ao recebimento passa a 'confirmado'
  update public.nfe_imports
     set status = 'confirmado', confirmed_at = now(), confirmed_by = v_user
   where tenant_id = v_receipt.tenant_id
     and goods_receipt_id = v_receipt.id
     and status <> 'cancelado';

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

revoke all on function public.confirm_goods_receipt(uuid) from public;
revoke all on function public.confirm_goods_receipt(uuid) from anon;
grant execute on function public.confirm_goods_receipt(uuid) to authenticated;
grant execute on function public.confirm_goods_receipt(uuid) to service_role;

-- ============================================================
-- 9. reverse_goods_receipt: idem para recebimento sem pedido
-- ============================================================
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

  if v_receipt.purchase_order_id is not null then
    select * into v_order from public.purchase_orders where id = v_receipt.purchase_order_id for update;
  end if;
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

      if v_item.purchase_order_item_id is not null then
        update public.purchase_order_items
           set received_qty = greatest(received_qty - v_item.accepted_qty, 0)
         where id = v_item.purchase_order_item_id;
      end if;
    end if;
  end loop;

  update public.goods_receipts
     set status = 'reversed', reversed_at = now(), reversed_by = v_user,
         reverse_reason = p_reason, updated_by = v_user
   where id = v_receipt.id;

  if v_order.id is not null then
    select bool_and(received_qty >= ordered_qty), bool_or(received_qty > 0)
      into v_all_received, v_any_received
      from public.purchase_order_items where purchase_order_id = v_order.id;

    v_new_status := case
      when coalesce(v_all_received, false) then 'received'
      when coalesce(v_any_received, false) then 'partially_received'
      else 'approved'
    end;

    update public.purchase_orders set status = v_new_status, updated_by = v_user where id = v_order.id;
  end if;

  -- NF-e vinculada volta para conferência
  update public.nfe_imports
     set status = 'em_conferencia', confirmed_at = null, confirmed_by = null
   where tenant_id = v_receipt.tenant_id
     and goods_receipt_id = v_receipt.id
     and status = 'confirmado';

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

revoke all on function public.reverse_goods_receipt(uuid, text) from public;
revoke all on function public.reverse_goods_receipt(uuid, text) from anon;
grant execute on function public.reverse_goods_receipt(uuid, text) to authenticated;
grant execute on function public.reverse_goods_receipt(uuid, text) to service_role;

commit;
