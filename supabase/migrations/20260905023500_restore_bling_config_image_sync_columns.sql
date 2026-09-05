-- Corrige drift do cutover: o código de Bling já consulta estes campos,
-- mas eles não estavam presentes no banco oficial.
alter table public.bling_config
  add column if not exists last_image_sync_product_id uuid references public.products(id) on delete set null,
  add column if not exists last_image_sync_at timestamptz;
