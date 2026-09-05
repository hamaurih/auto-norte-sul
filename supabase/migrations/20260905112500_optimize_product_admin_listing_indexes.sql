create extension if not exists pg_trgm with schema extensions;

create index if not exists products_tenant_name_live_idx
  on public.products (tenant_id, name)
  where deleted_at is null;

create index if not exists products_name_trgm_idx
  on public.products using gin (name extensions.gin_trgm_ops)
  where deleted_at is null;

create index if not exists products_sku_trgm_idx
  on public.products using gin (sku extensions.gin_trgm_ops)
  where deleted_at is null;

create index if not exists products_internal_code_trgm_idx
  on public.products using gin (internal_code extensions.gin_trgm_ops)
  where deleted_at is null and internal_code is not null;

create index if not exists products_manufacturer_code_trgm_idx
  on public.products using gin (manufacturer_code extensions.gin_trgm_ops)
  where deleted_at is null and manufacturer_code is not null;

analyze public.products;
