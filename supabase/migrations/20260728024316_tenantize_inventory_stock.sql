begin;

alter table public.product_stock add column tenant_id uuid;
alter table public.stock_movements add column tenant_id uuid;
alter table public.stock_transfers add column tenant_id uuid;
alter table public.stock_transfer_items add column tenant_id uuid;

update public.product_stock stock
set tenant_id = product.tenant_id
from public.products product
join public.warehouses warehouse on warehouse.tenant_id = product.tenant_id
where product.id = stock.product_id
  and warehouse.id = stock.warehouse_id;

update public.stock_movements movement
set tenant_id = product.tenant_id
from public.products product
join public.warehouses warehouse on warehouse.tenant_id = product.tenant_id
where product.id = movement.product_id
  and warehouse.id = movement.warehouse_id;

update public.stock_transfers transfer
set tenant_id = source.tenant_id
from public.warehouses source
join public.warehouses destination on destination.tenant_id = source.tenant_id
where source.id = transfer.from_warehouse_id
  and destination.id = transfer.to_warehouse_id;

update public.stock_transfer_items item
set tenant_id = transfer.tenant_id
from public.stock_transfers transfer
join public.products product on product.tenant_id = transfer.tenant_id
where transfer.id = item.transfer_id
  and product.id = item.product_id;

do $migration$
begin
  if exists (select 1 from public.product_stock where tenant_id is null) then
    raise exception 'product_stock contains cross-tenant or orphaned rows';
  end if;
  if exists (select 1 from public.stock_movements where tenant_id is null) then
    raise exception 'stock_movements contains cross-tenant or orphaned rows';
  end if;
  if exists (select 1 from public.stock_transfers where tenant_id is null) then
    raise exception 'stock_transfers contains cross-tenant or orphaned rows';
  end if;
  if exists (select 1 from public.stock_transfer_items where tenant_id is null) then
    raise exception 'stock_transfer_items contains cross-tenant or orphaned rows';
  end if;
end;
$migration$;

alter table public.product_stock alter column tenant_id set not null;
alter table public.stock_movements alter column tenant_id set not null;
alter table public.stock_transfers alter column tenant_id set not null;
alter table public.stock_transfer_items alter column tenant_id set not null;

alter table public.warehouses
  add constraint warehouses_id_tenant_key unique (id, tenant_id);

alter table public.product_stock
  drop constraint product_stock_product_id_fkey,
  drop constraint product_stock_warehouse_id_fkey,
  drop constraint product_stock_product_id_warehouse_id_key,
  add constraint product_stock_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products (id, tenant_id) on delete cascade,
  add constraint product_stock_warehouse_tenant_fkey
    foreign key (warehouse_id, tenant_id) references public.warehouses (id, tenant_id) on delete cascade,
  add constraint product_stock_tenant_product_warehouse_key
    unique (tenant_id, product_id, warehouse_id);

alter table public.stock_movements
  drop constraint stock_movements_product_id_fkey,
  drop constraint stock_movements_warehouse_id_fkey,
  add constraint stock_movements_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products (id, tenant_id) on delete cascade,
  add constraint stock_movements_warehouse_tenant_fkey
    foreign key (warehouse_id, tenant_id) references public.warehouses (id, tenant_id) on delete cascade;

alter table public.stock_transfers
  drop constraint stock_transfers_code_key,
  drop constraint stock_transfers_from_warehouse_id_fkey,
  drop constraint stock_transfers_to_warehouse_id_fkey,
  add constraint stock_transfers_id_tenant_key unique (id, tenant_id),
  add constraint stock_transfers_tenant_code_key unique (tenant_id, code),
  add constraint stock_transfers_source_tenant_fkey
    foreign key (from_warehouse_id, tenant_id) references public.warehouses (id, tenant_id),
  add constraint stock_transfers_destination_tenant_fkey
    foreign key (to_warehouse_id, tenant_id) references public.warehouses (id, tenant_id),
  add constraint stock_transfers_distinct_warehouses_check
    check (from_warehouse_id <> to_warehouse_id);

alter table public.stock_transfer_items
  drop constraint stock_transfer_items_product_id_fkey,
  drop constraint stock_transfer_items_transfer_id_fkey,
  add constraint stock_transfer_items_transfer_tenant_fkey
    foreign key (transfer_id, tenant_id) references public.stock_transfers (id, tenant_id) on delete cascade,
  add constraint stock_transfer_items_product_tenant_fkey
    foreign key (product_id, tenant_id) references public.products (id, tenant_id);

create index idx_product_stock_product_tenant
  on public.product_stock (product_id, tenant_id);
create index idx_product_stock_warehouse_tenant
  on public.product_stock (warehouse_id, tenant_id);
create index idx_stock_movements_tenant_created
  on public.stock_movements (tenant_id, created_at desc);
create index idx_stock_movements_product_tenant
  on public.stock_movements (product_id, tenant_id);
create index idx_stock_movements_warehouse_tenant
  on public.stock_movements (warehouse_id, tenant_id);
create index idx_stock_movements_user
  on public.stock_movements (user_id) where user_id is not null;
create index idx_stock_transfers_tenant_created
  on public.stock_transfers (tenant_id, created_at desc);
create index idx_stock_transfers_source_tenant
  on public.stock_transfers (from_warehouse_id, tenant_id);
create index idx_stock_transfers_destination_tenant
  on public.stock_transfers (to_warehouse_id, tenant_id);
create index idx_stock_transfers_created_by
  on public.stock_transfers (created_by) where created_by is not null;
create index idx_stock_transfer_items_transfer_tenant
  on public.stock_transfer_items (transfer_id, tenant_id);
create index idx_stock_transfer_items_product_tenant
  on public.stock_transfer_items (product_id, tenant_id);

drop policy if exists product_stock_auth_read on public.product_stock;
drop policy if exists product_stock_staff_all on public.product_stock;
drop policy if exists stock_mov_staff_read on public.stock_movements;
drop policy if exists stock_mov_staff_write on public.stock_movements;
drop policy if exists stock_transfers_staff_all on public.stock_transfers;
drop policy if exists stock_transfer_items_staff_all on public.stock_transfer_items;

alter table public.product_stock enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;

create policy product_stock_storefront_read
on public.product_stock for select to anon
using (tenant_id = (select private.requested_storefront_tenant_id()));

create policy branches_storefront_read
on public.branches for select to anon
using (
  active
  and tenant_id = (select private.requested_storefront_tenant_id())
);

create policy warehouses_storefront_read
on public.warehouses for select to anon
using (
  active
  and tenant_id = (select private.requested_storefront_tenant_id())
);

create policy product_stock_member_read
on public.product_stock for select to authenticated
using ((select private.has_tenant_role(tenant_id, null)));

create policy product_stock_operator_insert
on public.product_stock for insert to authenticated
with check ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)));

create policy product_stock_operator_update
on public.product_stock for update to authenticated
using ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)))
with check ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)));

create policy product_stock_operator_delete
on public.product_stock for delete to authenticated
using ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)));

create policy stock_movements_member_read
on public.stock_movements for select to authenticated
using ((select private.has_tenant_role(tenant_id, null)));

create policy stock_movements_operator_insert
on public.stock_movements for insert to authenticated
with check ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock', 'sales', 'cashier']
)));

create policy stock_transfers_member_read
on public.stock_transfers for select to authenticated
using ((select private.has_tenant_role(tenant_id, null)));

create policy stock_transfers_operator_insert
on public.stock_transfers for insert to authenticated
with check ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)));

create policy stock_transfers_operator_update
on public.stock_transfers for update to authenticated
using ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)))
with check ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)));

create policy stock_transfers_operator_delete
on public.stock_transfers for delete to authenticated
using ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)));

create policy stock_transfer_items_member_read
on public.stock_transfer_items for select to authenticated
using ((select private.has_tenant_role(tenant_id, null)));

create policy stock_transfer_items_operator_insert
on public.stock_transfer_items for insert to authenticated
with check ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)));

create policy stock_transfer_items_operator_update
on public.stock_transfer_items for update to authenticated
using ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)))
with check ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)));

create policy stock_transfer_items_operator_delete
on public.stock_transfer_items for delete to authenticated
using ((select private.has_tenant_role(
  tenant_id, array['owner', 'admin', 'manager', 'stock']
)));

drop view public.v_product_stock_available;
create view public.v_product_stock_available
with (security_invoker = true)
as
select
  product.tenant_id,
  product.id as product_id,
  coalesce(sum(greatest(stock.on_hand - stock.reserved, 0)), 0)::integer as available_multi,
  coalesce(sum(stock.on_hand), 0)::integer as on_hand_multi,
  coalesce(sum(stock.reserved), 0)::integer as reserved_multi,
  product.stock as legacy_stock,
  case
    when count(stock.id) > 0
      then coalesce(sum(greatest(stock.on_hand - stock.reserved, 0)), 0)::integer
    else coalesce(product.stock, 0)
  end as available_effective,
  count(stock.id) > 0 as has_multi_stock
from public.products product
left join public.product_stock stock
  on stock.product_id = product.id
 and stock.tenant_id = product.tenant_id
group by product.tenant_id, product.id, product.stock;

revoke all on table public.product_stock from anon, authenticated;
revoke all on table public.stock_movements from anon, authenticated;
revoke all on table public.stock_transfers from anon, authenticated;
revoke all on table public.stock_transfer_items from anon, authenticated;
revoke all on table public.v_product_stock_available from anon, authenticated;

grant select on table public.product_stock to anon;
grant select (id, tenant_id, name, code, active)
  on table public.branches to anon;
grant select (id, tenant_id, branch_id, name, code, active)
  on table public.warehouses to anon;
grant select, insert, update, delete
  on table public.product_stock to authenticated;
grant select, insert
  on table public.stock_movements to authenticated;
grant select, insert, update, delete
  on table public.stock_transfers to authenticated;
grant select, insert, update, delete
  on table public.stock_transfer_items to authenticated;
grant select on table public.v_product_stock_available to anon, authenticated;

commit;
