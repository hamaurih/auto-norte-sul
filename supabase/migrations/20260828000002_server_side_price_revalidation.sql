-- SEC-03 / DAT-08: preços e estoque são revalidados no banco antes do checkout.

CREATE OR REPLACE FUNCTION public.validate_cart_items(
  p_tenant_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_quantity integer;
  v_stock_rows integer;
  v_stock_available integer;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_tenant_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'carrinho inválido';
  END IF;
  IF jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'carrinho deve conter de 1 a 100 itens';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
      OR COALESCE(v_item->>'product_id', '') !~ '^[0-9a-fA-F-]{36}$'
      OR COALESCE(v_item->>'quantity', '') !~ '^[1-9][0-9]{0,3}$' THEN
      RAISE EXCEPTION 'item de carrinho inválido';
    END IF;

    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity > 1000 THEN
      RAISE EXCEPTION 'quantidade máxima por item excedida';
    END IF;
    IF (
      SELECT count(*)
      FROM jsonb_array_elements(p_items) AS duplicate_item
      WHERE duplicate_item->>'product_id' = v_item->>'product_id'
    ) > 1 THEN
      RAISE EXCEPTION 'não repita produtos no carrinho';
    END IF;

    SELECT
      p.id, p.sku, p.name, p.active,
      p.price_b2c,
      COALESCE(p.sale_price_b2c, p.price_b2c) AS unit_price,
      p.stock
    INTO v_product
    FROM public.products p
    WHERE p.id = v_product_id
      AND p.tenant_id = p_tenant_id;

    IF NOT FOUND OR NOT v_product.active THEN
      RAISE EXCEPTION 'produto não está disponível';
    END IF;
    IF v_product.unit_price IS NULL OR v_product.unit_price <= 0 THEN
      RAISE EXCEPTION 'produto sem preço válido';
    END IF;

    SELECT count(*)::integer,
           COALESCE(sum(GREATEST(ps.on_hand - ps.reserved, 0)), 0)::integer
    INTO v_stock_rows, v_stock_available
    FROM public.product_stock ps
    WHERE ps.product_id = v_product.id
      AND ps.tenant_id = p_tenant_id;
    IF v_stock_rows = 0 THEN
      v_stock_available := GREATEST(COALESCE(v_product.stock, 0), 0);
    END IF;
    IF v_quantity > v_stock_available THEN
      RAISE EXCEPTION 'estoque insuficiente para "%" (disponível: %, solicitado: %)',
        v_product.name, v_stock_available, v_quantity;
    END IF;

    v_results := v_results || jsonb_build_object(
      'product_id', v_product.id,
      'sku', v_product.sku,
      'name', v_product.name,
      'quantity', v_quantity,
      'unit_price', v_product.unit_price,
      'list_price', v_product.price_b2c,
      'stock_available', v_stock_available
    );
  END LOOP;

  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_cart_items(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_cart_items(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.validate_cart_items(uuid, jsonb)
  IS 'SEC-03/DAT-08: revalida preço, disponibilidade e estoque sem confiar no frontend.';

