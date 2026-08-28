-- ARC-62: soft-delete nas entidades com histórico.
-- ARC-63: updated_at consistente para concorrência e sincronizações.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT pg_catalog.now();
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT pg_catalog.now();
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT pg_catalog.now();
ALTER TABLE public.product_stock
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT pg_catalog.now();

CREATE INDEX IF NOT EXISTS idx_products_active_tenant
  ON public.products (tenant_id, active, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_active_tenant
  ON public.quotes (tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_active_tenant
  ON public.orders (tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  target_table text;
  trigger_name text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['products', 'quotes', 'orders', 'product_stock']
  LOOP
    trigger_name := 'trg_' || target_table || '_updated_at';
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = trigger_name
        AND tgrelid = ('public.' || target_table)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        trigger_name, target_table
      );
    END IF;
  END LOOP;
END;
$$;

COMMENT ON COLUMN public.products.deleted_at IS 'ARC-62: soft delete — preservar histórico de pedidos e estoque.';
COMMENT ON COLUMN public.quotes.deleted_at IS 'ARC-62: soft delete de orçamentos.';
COMMENT ON COLUMN public.orders.deleted_at IS 'ARC-62: soft delete de pedidos.';
COMMENT ON FUNCTION public.set_updated_at() IS 'ARC-63: atualiza updated_at em qualquer UPDATE.';

