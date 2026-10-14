alter table public.bling_config
  add column if not exists last_stock_sync_product_id uuid,
  add column if not exists last_stock_sync_at timestamptz;
