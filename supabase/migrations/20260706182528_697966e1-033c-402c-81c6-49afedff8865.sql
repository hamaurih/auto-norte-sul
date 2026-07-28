
-- Trigger: auto-deactivate products when stock hits zero or below.
CREATE OR REPLACE FUNCTION public.auto_deactivate_out_of_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stock IS NULL OR NEW.stock <= 0 THEN
    NEW.active := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_auto_deactivate ON public.products;
CREATE TRIGGER trg_products_auto_deactivate
BEFORE INSERT OR UPDATE OF stock ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.auto_deactivate_out_of_stock();

-- Apply retroactively to current out-of-stock rows.
UPDATE public.products
   SET active = false
 WHERE (stock IS NULL OR stock <= 0)
   AND active = true;
