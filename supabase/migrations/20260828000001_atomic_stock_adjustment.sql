-- DAT-07: ajuste de estoque atômico e auditável.
-- O RPC é privado para a aplicação: somente server functions com service_role
-- podem executá-lo depois de validar a sessão e o papel do operador.

CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_tenant_id uuid,
  p_product_id uuid,
  p_warehouse_id uuid,
  p_type text,
  p_qty integer,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current public.product_stock%ROWTYPE;
  v_new_on_hand integer;
  v_delta integer;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_tenant_id IS NULL OR p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'tenant, produto e depósito são obrigatórios';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('IN', 'OUT', 'ADJUST') THEN
    RAISE EXCEPTION 'tipo de movimento inválido';
  END IF;
  IF p_qty IS NULL OR p_qty < 0 OR (p_type <> 'ADJUST' AND p_qty = 0) THEN
    RAISE EXCEPTION 'quantidade inválida';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = p_product_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'produto não pertence ao tenant';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses
    WHERE id = p_warehouse_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'depósito não pertence ao tenant';
  END IF;

  SELECT * INTO v_current
  FROM public.product_stock
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND warehouse_id = p_warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.product_stock (tenant_id, product_id, warehouse_id, on_hand, reserved)
    VALUES (p_tenant_id, p_product_id, p_warehouse_id, 0, 0)
    ON CONFLICT (tenant_id, product_id, warehouse_id) DO NOTHING;

    SELECT * INTO v_current
    FROM public.product_stock
    WHERE tenant_id = p_tenant_id
      AND product_id = p_product_id
      AND warehouse_id = p_warehouse_id
    FOR UPDATE;
  END IF;

  IF p_type = 'ADJUST' THEN
    v_new_on_hand := p_qty;
    v_delta := v_new_on_hand - COALESCE(v_current.on_hand, 0);
  ELSIF p_type = 'OUT' THEN
    IF p_qty > GREATEST(COALESCE(v_current.on_hand, 0) - COALESCE(v_current.reserved, 0), 0) THEN
      RAISE EXCEPTION 'estoque disponível insuficiente';
    END IF;
    v_delta := -p_qty;
    v_new_on_hand := COALESCE(v_current.on_hand, 0) + v_delta;
  ELSE
    v_delta := p_qty;
    v_new_on_hand := COALESCE(v_current.on_hand, 0) + v_delta;
  END IF;

  IF v_new_on_hand < COALESCE(v_current.reserved, 0) THEN
    RAISE EXCEPTION 'estoque não pode ficar abaixo do reservado';
  END IF;

  UPDATE public.product_stock
  SET on_hand = v_new_on_hand, updated_at = pg_catalog.now()
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND warehouse_id = p_warehouse_id;

  IF v_delta <> 0 THEN
    INSERT INTO public.stock_movements (
      tenant_id, product_id, warehouse_id, type, qty, reference, notes, user_id
    ) VALUES (
      p_tenant_id, p_product_id, p_warehouse_id,
      p_type::public.stock_movement_type, abs(v_delta),
      NULLIF(pg_catalog.left(p_reference, 200), ''),
      NULLIF(pg_catalog.left(p_notes, 2000), ''),
      p_user_id
    );
  END IF;

  RETURN v_new_on_hand;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_product_stock(uuid, uuid, uuid, text, integer, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_product_stock(uuid, uuid, uuid, text, integer, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.adjust_product_stock(uuid, uuid, uuid, text, integer, text, text, uuid)
  IS 'DAT-07: atualiza estoque com lock transacional e registra movimento sem permitir saída do reservado.';

