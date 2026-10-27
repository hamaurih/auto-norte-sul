begin;

drop policy if exists purchase_quotation_items_write on public.purchase_quotation_items;
create policy purchase_quotation_items_insert on public.purchase_quotation_items
for insert to authenticated with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotation_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy purchase_quotation_items_update on public.purchase_quotation_items
for update to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotation_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
)) with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotation_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy purchase_quotation_items_delete on public.purchase_quotation_items
for delete to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotation_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));

drop policy if exists supplier_quotes_write on public.supplier_quotes;
create policy supplier_quotes_insert on public.supplier_quotes
for insert to authenticated with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quotes.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy supplier_quotes_update on public.supplier_quotes
for update to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quotes.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
)) with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quotes.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy supplier_quotes_delete on public.supplier_quotes
for delete to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quotes.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));

drop policy if exists supplier_quote_items_write on public.supplier_quote_items;
create policy supplier_quote_items_insert on public.supplier_quote_items
for insert to authenticated with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quote_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy supplier_quote_items_update on public.supplier_quote_items
for update to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quote_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
)) with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quote_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy supplier_quote_items_delete on public.supplier_quote_items
for delete to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quote_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));

create index if not exists purchase_quotations_purchase_order_idx on public.purchase_quotations(purchase_order_id) where purchase_order_id is not null;
create index if not exists purchase_quotations_selected_quote_idx on public.purchase_quotations(selected_supplier_quote_id) where selected_supplier_quote_id is not null;
create index if not exists purchase_quotation_items_product_idx on public.purchase_quotation_items(tenant_id,product_id);
create index if not exists supplier_quote_items_product_idx on public.supplier_quote_items(tenant_id,product_id);
create index if not exists supplier_quote_items_quotation_item_idx on public.supplier_quote_items(quotation_item_id);

commit;