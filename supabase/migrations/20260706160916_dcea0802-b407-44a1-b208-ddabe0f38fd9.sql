
-- Extend bling_config with strategic source-of-truth flags and OAuth metadata
ALTER TABLE public.bling_config
  ADD COLUMN IF NOT EXISTS client_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS redirect_uri TEXT,
  ADD COLUMN IF NOT EXISTS source_products BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS source_stock BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS source_price_b2c BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_sync BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_status TEXT;

-- Ensure a single config row exists (Bling has one org-wide config)
INSERT INTO public.bling_config (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM public.bling_config);

-- Helpful index for logs page
CREATE INDEX IF NOT EXISTS bling_sync_logs_created_at_idx
  ON public.bling_sync_logs (created_at DESC);
