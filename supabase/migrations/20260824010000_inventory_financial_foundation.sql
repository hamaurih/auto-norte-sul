begin;

alter table public.goods_receipts
  add column if not exists freight_amount numeric(14,2) not null default 0,
  add column if not exists insurance_amount numeric(14,2) not null default 0,
  add column if not exists other_amount numeric(14,2) not null default 0,
  add column if not exists discount_amount numeric(14,2) not null default 0,
  add column if not exists recoverable_tax_amount numeric(14,2) not null default 0;

alter table public.goods_receipt_items
  add column if not exists base_unit_cost numeric(14,4),
  add column if not exists allocated_expense_amount numeric(14,2) not null default 0,
  add column if not exists allocated_discount_amount numeric(14,2) not null default 0,
  add column if not exists recoverable_tax_amount numeric(14,2) not null default 0,
  add column if not exists acquisition_unit_cost numeric(14,4);

update public.goods_receipt_items
set base_unit_cost = unit_cost,
    acquisition_unit_cost = unit_cost
where base_unit_cost is null or acquisition_unit_cost is null;

alter table public.goods_receipt_items
  alter column base_unit_cost set not null,
  alter column acquisition_unit_cost set not null;

alter table public.goods_receipts
  drop constraint if exists goods_receipts_financial_amounts_check;
alter table public.goods_receipts
  add constraint goods_receipts_financial_amounts_check check (
    freight_amount >= 0 and insurance_amount >= 0 and other_amount >= 0
    and discount_amount >= 0 and recoverable_tax_amount >= 0
  ) not valid;
alter table public.goods_receipts validate constraint goods_receipts_financial_amounts_check;

alter table public.goods_receipt_items
  drop constraint if exists goods_receipt_items_financial_amounts_check;
alter table public.goods_receipt_items
  add constraint goods_receipt_items_financial_amounts_check check (
    base_unit_cost >= 0 and allocated_expense_amount >= 0
    and allocated_discount_amount >= 0 and recoverable_tax_amount >= 0
    and acquisition_unit_cost >= 0
  ) not valid;
alter table public.goods_receipt_items validate constraint goods_receipt_items_financial_amounts_check;

create table if not exists public.inventory_closings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_date date not null,
  status text not null default 'closed' check (status in ('closed','reopened')),
  products_count integer not null default 0 check (products_count >= 0),
  units_total numeric(18,3) not null default 0,
  inventory_value numeric(18,2) not null default 0,
  missing_cost_products integer not null default 0 check (missing_cost_products >= 0),
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  reopen_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, period_date)
);

create table if not exists public.inventory_closing_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  closing_id uuid not null references public.inventory_closings(id) on delete cascade,
  product_id uuid not null,
  warehouse_id uuid not null,
  on_hand numeric(18,3) not null,
  average_cost numeric(14,4),
  inventory_value numeric(18,2) not null default 0,
  cost_status text not null check (cost_status in ('valued','missing')),
  created_at timestamptz not null default now(),
  constraint inventory_closing_items_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete restrict,
  constraint inventory_closing_items_unique unique (closing_id, product_id, warehouse_id)
);

create index if not exists inventory_closings_tenant_period_idx
  on public.inventory_closings (tenant_id, period_date desc);
create index if not exists inventory_closing_items_tenant_closing_idx
  on public.inventory_closing_items (tenant_id, closing_id);
create index if not exists inventory_closing_items_product_idx
  on public.inventory_closing_items (product_id);
create index if not exists inventory_closing_items_warehouse_idx
  on public.inventory_closing_items (warehouse_id);

alter table public.inventory_closings enable row level security;
alter table public.inventory_closing_items enable row level security;

drop policy if exists inventory_closings_select_members on public.inventory_closings;
create policy inventory_closings_select_members on public.inventory_closings
for select to authenticated using ((select private.has_tenant_role(tenant_id, null)));

drop policy if exists inventory_closing_items_select_members on public.inventory_closing_items;
create policy inventory_closing_items_select_members on public.inventory_closing_items
for select to authenticated using ((select private.has_tenant_role(tenant_id, null)));

grant select on public.inventory_closings, public.inventory_closing_items to authenticated;
grant all on public.inventory_closings, public.inventory_closing_items to service_role;
revoke all on public.inventory_closings, public.inventory_closing_items from anon;

create or replace function public.get_inventory_financial_position()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  select m.tenant_id into v_tenant
  from public.tenant_memberships m
  where m.user_id=v_user and m.active
  order by m.created_at limit 1;
  if v_tenant is null then raise exception 'Empresa não encontrada'; end if;

  select jsonb_build_object(
    'products_with_stock', count(*) filter (where s.on_hand > 0),
    'valued_products', count(*) filter (where s.on_hand > 0 and p.average_cost is not null),
    'missing_cost_products', count(*) filter (where s.on_hand > 0 and p.average_cost is null),
    'units_total', coalesce(sum(s.on_hand) filter (where s.on_hand > 0),0),
    'inventory_value', coalesce(sum(s.on_hand * coalesce(p.average_cost,0)) filter (where s.on_hand > 0),0),
    'potential_revenue', coalesce(sum(s.on_hand * p.price_b2c) filter (where s.on_hand > 0),0),
    'potential_gross_profit', coalesce(sum(s.on_hand * (p.price_b2c-coalesce(p.average_cost,0))) filter (where s.on_hand > 0 and p.average_cost is not null),0),
    'stock_divergence_products', (
      select count(*) from public.products px
      left join (select product_id,sum(on_hand) qty from public.product_stock where tenant_id=v_tenant group by product_id) ps on ps.product_id=px.id
      where px.tenant_id=v_tenant and px.stock <> coalesce(ps.qty,0)
    )
  ) into v_result
  from public.products p
  join (
    select product_id, sum(on_hand)::numeric as on_hand
    from public.product_stock where tenant_id=v_tenant group by product_id
  ) s on s.product_id=p.id
  where p.tenant_id=v_tenant;

  return coalesce(v_result,'{}'::jsonb);
end;
$$;

create or replace function public.close_inventory_period(p_period_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_closing_id uuid;
  v_period date := (date_trunc('month',p_period_date)::date + interval '1 month - 1 day')::date;
  v_org uuid;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  select m.tenant_id into v_tenant
  from public.tenant_memberships m
  where m.user_id=v_user and m.active and m.role in ('owner','admin','manager')
  order by m.created_at limit 1;
  if v_tenant is null then raise exception 'Usuário sem permissão para fechar estoque'; end if;
  if v_period > current_date then raise exception 'Não é permitido fechar período futuro'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || v_period::text,0));

  select id into v_closing_id from public.inventory_closings
  where tenant_id=v_tenant and period_date=v_period for update;
  if v_closing_id is not null then
    return jsonb_build_object('ok',true,'already_closed',true,'closing_id',v_closing_id,'period_date',v_period);
  end if;

  insert into public.inventory_closings(tenant_id,period_date,closed_by)
  values(v_tenant,v_period,v_user) returning id into v_closing_id;

  insert into public.inventory_closing_items
    (tenant_id,closing_id,product_id,warehouse_id,on_hand,average_cost,inventory_value,cost_status)
  select v_tenant,v_closing_id,ps.product_id,ps.warehouse_id,ps.on_hand,p.average_cost,
         round(ps.on_hand*coalesce(p.average_cost,0),2),
         case when p.average_cost is null then 'missing' else 'valued' end
  from public.product_stock ps
  join public.products p on p.id=ps.product_id and p.tenant_id=ps.tenant_id
  where ps.tenant_id=v_tenant and ps.on_hand<>0
  order by ps.product_id,ps.warehouse_id
  for share of ps,p;

  update public.inventory_closings c set
    products_count=x.products_count,
    units_total=x.units_total,
    inventory_value=x.inventory_value,
    missing_cost_products=x.missing_cost_products
  from (
    select count(distinct product_id)::int products_count,
           coalesce(sum(on_hand),0) units_total,
           coalesce(sum(inventory_value),0) inventory_value,
           count(distinct product_id) filter(where cost_status='missing')::int missing_cost_products
    from public.inventory_closing_items where closing_id=v_closing_id
  ) x where c.id=v_closing_id;

  select organization_id into v_org from public.tenants where id=v_tenant;
  insert into public.audit_events
    (organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data)
  select v_org,v_tenant,v_user,'inventory.period_closed','inventory_closing',v_closing_id::text,
         to_jsonb(c) from public.inventory_closings c where c.id=v_closing_id;

  return (select jsonb_build_object('ok',true,'already_closed',false,'closing_id',id,
    'period_date',period_date,'products_count',products_count,'units_total',units_total,
    'inventory_value',inventory_value,'missing_cost_products',missing_cost_products)
    from public.inventory_closings where id=v_closing_id);
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
  v_cost record;
  v_org uuid;
  v_stock_id uuid;
  v_all_received boolean;
  v_any_received boolean;
  v_new_status text;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'Informe o motivo do estorno'; end if;
  select * into v_receipt from public.goods_receipts where id=p_receipt_id for update;
  if v_receipt.id is null then raise exception 'Recebimento não encontrado'; end if;
  if not exists(select 1 from public.tenant_memberships m where m.user_id=v_user and m.tenant_id=v_receipt.tenant_id and m.active and m.role in ('owner','admin','manager')) then
    raise exception 'Usuário sem permissão para estornar recebimento';
  end if;
  if v_receipt.status='reversed' then return jsonb_build_object('ok',true,'already_reversed',true,'receipt_id',v_receipt.id); end if;
  if v_receipt.status<>'confirmed' then raise exception 'Somente recebimento confirmado pode ser estornado'; end if;
  select * into v_order from public.purchase_orders where id=v_receipt.purchase_order_id for update;
  select organization_id into v_org from public.tenants where id=v_receipt.tenant_id;

  for v_item in select * from public.goods_receipt_items where goods_receipt_id=v_receipt.id order by product_id,id loop
    if v_item.accepted_qty>0 then
      if exists(
        select 1 from public.product_cost_history h
        join public.product_cost_history original on original.tenant_id=h.tenant_id and original.product_id=h.product_id
        where original.reference_id=v_receipt.id and original.source='goods_receipt'
          and h.tenant_id=v_receipt.tenant_id and h.product_id=v_item.product_id
          and h.source='goods_receipt' and h.created_at>original.created_at
      ) then raise exception 'Existe recebimento posterior para o produto %. Estorne primeiro o recebimento mais recente.',v_item.product_id; end if;

      select * into v_cost from public.product_cost_history
      where tenant_id=v_receipt.tenant_id and product_id=v_item.product_id
        and source='goods_receipt' and reference_id=v_receipt.id
      order by created_at desc limit 1 for update;

      select id into v_stock_id from public.product_stock
      where tenant_id=v_receipt.tenant_id and product_id=v_item.product_id and warehouse_id=v_receipt.warehouse_id for update;
      if v_stock_id is null then raise exception 'Saldo do produto % não encontrado',v_item.product_id; end if;
      if (select on_hand from public.product_stock where id=v_stock_id)<v_item.accepted_qty then
        raise exception 'Saldo insuficiente para estornar o produto %',v_item.product_id;
      end if;
      update public.product_stock set on_hand=on_hand-v_item.accepted_qty where id=v_stock_id;
      insert into public.stock_movements(tenant_id,product_id,warehouse_id,type,qty,reference,notes,user_id)
      values(v_receipt.tenant_id,v_item.product_id,v_receipt.warehouse_id,'OUT',v_item.accepted_qty,
        'goods_receipt_reversal:'||v_receipt.id::text,'Estorno do recebimento #'||v_receipt.number::text,v_user);

      update public.products set average_cost=v_cost.previous_average_cost,
        last_purchase_cost=v_cost.previous_last_cost,
        last_purchase_at=(select max(created_at) from public.product_cost_history h where h.tenant_id=v_receipt.tenant_id and h.product_id=v_item.product_id and h.source='goods_receipt' and h.reference_id<>v_receipt.id)
      where id=v_item.product_id and tenant_id=v_receipt.tenant_id;

      insert into public.product_cost_history(tenant_id,product_id,source,reference_id,qty,unit_cost,
        previous_average_cost,new_average_cost,previous_last_cost,new_last_cost,created_by)
      values(v_receipt.tenant_id,v_item.product_id,'goods_receipt_reversal',v_receipt.id,-v_item.accepted_qty,
        coalesce(v_item.acquisition_unit_cost,v_item.unit_cost),v_cost.new_average_cost,v_cost.previous_average_cost,
        v_cost.new_last_cost,v_cost.previous_last_cost,v_user);
      update public.purchase_order_items set received_qty=greatest(received_qty-v_item.accepted_qty,0)
      where id=v_item.purchase_order_item_id;
    end if;
  end loop;

  update public.goods_receipts set status='reversed',reversed_at=now(),reversed_by=v_user,
    reverse_reason=p_reason,updated_by=v_user where id=v_receipt.id;
  select bool_and(received_qty>=ordered_qty),bool_or(received_qty>0) into v_all_received,v_any_received
  from public.purchase_order_items where purchase_order_id=v_order.id;
  v_new_status:=case when coalesce(v_all_received,false) then 'received' when coalesce(v_any_received,false) then 'partially_received' else 'approved' end;
  update public.purchase_orders set status=v_new_status,updated_by=v_user where id=v_order.id;
  insert into public.audit_events(organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data,metadata)
  values(v_org,v_receipt.tenant_id,v_user,'goods_receipt.reversed','goods_receipt',v_receipt.id::text,
    jsonb_build_object('status','reversed'),jsonb_build_object('reason',p_reason,'purchase_order_id',v_order.id,'order_status',v_new_status,'cost_restored',true));
  return jsonb_build_object('ok',true,'already_reversed',false,'receipt_id',v_receipt.id,'status','reversed','purchase_order_status',v_new_status);
end;
$$;

revoke all on function public.get_inventory_financial_position() from public,anon;
revoke all on function public.close_inventory_period(date) from public,anon;
revoke all on function public.reverse_goods_receipt(uuid,text) from public,anon;
grant execute on function public.get_inventory_financial_position() to authenticated,service_role;
grant execute on function public.close_inventory_period(date) to authenticated,service_role;
grant execute on function public.reverse_goods_receipt(uuid,text) to authenticated,service_role;

commit;
