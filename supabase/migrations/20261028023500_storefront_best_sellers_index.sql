begin;

create index if not exists products_storefront_best_sellers_idx
  on public.products(tenant_id, sales_count desc, name)
  where deleted_at is null
    and active = true
    and available_for_online = true;

commit;
