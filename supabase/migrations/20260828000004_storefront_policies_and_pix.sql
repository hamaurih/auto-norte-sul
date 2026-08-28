-- Storefront: não expor produtos soft-deleted e aplicar desconto PIX no servidor.

DROP POLICY IF EXISTS products_storefront_read ON public.products;
CREATE POLICY products_storefront_read ON public.products
FOR SELECT TO anon
USING (
  tenant_id = (SELECT private.requested_storefront_tenant_id())
  AND active
  AND deleted_at IS NULL
  AND price_b2c > 0
  AND (stock > 0 OR NOT hide_when_out_of_stock)
);

DROP POLICY IF EXISTS products_member_read ON public.products;
CREATE POLICY products_member_read ON public.products
FOR SELECT TO authenticated
USING (
  (
    tenant_id = (SELECT private.requested_storefront_tenant_id())
    AND active
    AND deleted_at IS NULL
    AND price_b2c > 0
    AND (stock > 0 OR NOT hide_when_out_of_stock)
  )
  OR (SELECT private.has_tenant_role(products.tenant_id))
);

CREATE OR REPLACE FUNCTION public.internal_create_storefront_order(
  p_user_id uuid,
  p_tenant_slug text,
  p_customer jsonb,
  p_items jsonb,
  p_payment_method text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_order_id uuid;
  v_tenant_id uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config(
    'request.headers',
    jsonb_build_object('x-tenant-slug', p_tenant_slug)::text,
    true
  );

  v_tenant_id := private.requested_storefront_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant storefront inválido';
  END IF;

  v_order_id := private.create_storefront_order(
    p_customer, p_items, p_payment_method, p_idempotency_key
  );

  IF lower(p_payment_method) = 'pix' THEN
    UPDATE public.orders
    SET discount = pg_catalog.round(COALESCE(subtotal, 0) * 0.05, 2),
        total = pg_catalog.round(COALESCE(subtotal, 0) * 0.95, 2),
        updated_at = pg_catalog.now()
    WHERE id = v_order_id AND tenant_id = v_tenant_id;
  END IF;

  RETURN v_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_create_storefront_order(uuid, text, jsonb, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_create_storefront_order(uuid, text, jsonb, jsonb, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.internal_create_storefront_order(uuid, text, jsonb, jsonb, text, uuid)
  IS 'Cria pedido storefront com preços/estoque do banco e desconto PIX aplicado na transação.';
