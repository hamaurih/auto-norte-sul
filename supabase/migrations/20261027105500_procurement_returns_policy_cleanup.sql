begin;

drop policy if exists supplier_returns_write on public.supplier_returns;
create policy supplier_returns_insert on public.supplier_returns
for insert to authenticated
with check (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_returns.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
));
create policy supplier_returns_update on public.supplier_returns
for update to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_returns.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
))
with check (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_returns.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
));
create policy supplier_returns_delete on public.supplier_returns
for delete to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_returns.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
));

drop policy if exists supplier_return_items_write on public.supplier_return_items;
create policy supplier_return_items_insert on public.supplier_return_items
for insert to authenticated
with check (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_return_items.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
));
create policy supplier_return_items_update on public.supplier_return_items
for update to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_return_items.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
))
with check (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_return_items.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
));
create policy supplier_return_items_delete on public.supplier_return_items
for delete to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_return_items.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
));

create index if not exists supplier_returns_supplier_idx on public.supplier_returns(tenant_id,supplier_id);
create index if not exists supplier_returns_warehouse_idx on public.supplier_returns(tenant_id,warehouse_id);
create index if not exists supplier_returns_purchase_order_idx on public.supplier_returns(tenant_id,purchase_order_id) where purchase_order_id is not null;
create index if not exists supplier_return_items_product_idx on public.supplier_return_items(tenant_id,product_id);
create index if not exists supplier_return_items_receipt_item_idx on public.supplier_return_items(goods_receipt_item_id) where goods_receipt_item_id is not null;
create index if not exists goods_receipt_discrepancies_receipt_idx on public.goods_receipt_discrepancies(tenant_id,goods_receipt_id);

commit;