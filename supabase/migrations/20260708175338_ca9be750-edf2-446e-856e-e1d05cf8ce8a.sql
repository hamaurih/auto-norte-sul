-- Corrige regra de estoque: se existir product_stock, usar multi; senão, legacy. Nunca somar.
CREATE OR REPLACE VIEW public.v_product_stock_available
WITH (security_invoker = true) AS
SELECT
  p.id AS product_id,
  COALESCE(SUM(GREATEST(ps.on_hand - ps.reserved, 0)), 0)::INTEGER AS available_multi,
  COALESCE(SUM(ps.on_hand), 0)::INTEGER AS on_hand_multi,
  COALESCE(SUM(ps.reserved), 0)::INTEGER AS reserved_multi,
  p.stock AS legacy_stock,
  CASE
    WHEN COUNT(ps.id) > 0
      THEN COALESCE(SUM(GREATEST(ps.on_hand - ps.reserved, 0)), 0)::INTEGER
    ELSE COALESCE(p.stock, 0)
  END AS available_effective,
  (COUNT(ps.id) > 0) AS has_multi_stock
FROM public.products p
LEFT JOIN public.product_stock ps ON ps.product_id = p.id
GROUP BY p.id, p.stock;

GRANT SELECT ON public.v_product_stock_available TO anon, authenticated;