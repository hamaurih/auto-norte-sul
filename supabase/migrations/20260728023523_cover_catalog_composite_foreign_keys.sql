-- FK-leading indexes complement tenant-leading indexes used by storefront queries.
create index products_brand_tenant_fk_idx
  on public.products (brand_id, tenant_id) where brand_id is not null;
create index products_category_tenant_fk_idx
  on public.products (category_id, tenant_id) where category_id is not null;
create index products_subcategory_tenant_fk_idx
  on public.products (subcategory_id, tenant_id) where subcategory_id is not null;
create index product_images_product_tenant_fk_idx
  on public.product_images (product_id, tenant_id);
create index product_applications_product_tenant_fk_idx
  on public.product_applications (product_id, tenant_id);
