DROP POLICY IF EXISTS product_stock_auth_read ON public.product_stock;

CREATE POLICY product_stock_staff_read ON public.product_stock
FOR SELECT TO authenticated
USING (
  private.is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ANY (ARRAY['admin'::app_role,'gerente'::app_role,'vendedor'::app_role])
  )
);

REVOKE ALL ON public.product_stock FROM anon;
REVOKE ALL ON public.ai_product_embeddings FROM anon;
REVOKE ALL ON public.sales_reps FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_stock TO authenticated;
GRANT SELECT ON public.ai_product_embeddings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_reps TO authenticated;
GRANT ALL ON public.product_stock TO service_role;
GRANT ALL ON public.ai_product_embeddings TO service_role;
GRANT ALL ON public.sales_reps TO service_role;