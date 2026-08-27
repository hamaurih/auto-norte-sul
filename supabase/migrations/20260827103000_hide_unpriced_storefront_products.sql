-- Prevent products without a valid retail price from being exposed or sold
-- on the public storefront. Tenant members retain access for cost/price sanitation.

drop policy if exists products_storefront_read on public.products;
create policy products_storefront_read on public.products
for select to anon
using (
  tenant_id = (select private.requested_storefront_tenant_id())
  and active
  and price_b2c > 0
  and (stock > 0 or not hide_when_out_of_stock)
);

drop policy if exists products_member_read on public.products;
create policy products_member_read on public.products
for select to authenticated
using (
  (
    tenant_id = (select private.requested_storefront_tenant_id())
    and active
    and price_b2c > 0
    and (stock > 0 or not hide_when_out_of_stock)
  )
  or (select private.has_tenant_role(tenant_id))
);
