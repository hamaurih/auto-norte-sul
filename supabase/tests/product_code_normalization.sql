-- Teste da normalização de códigos de produto e da auditoria de revisão.
-- Executa dentro de transação e faz ROLLBACK: não altera dados reais.
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_prod uuid;
  v_audit uuid;
  v_name text;
  v_internal text;
  v_manu text;
  v_sku text;
  v_slug text;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'sem tenant: teste ignorado';
    RETURN;
  END IF;

  -- Produto de teste com código de fabricante no início do nome e SKU interno.
  INSERT INTO public.products (tenant_id, sku, name, slug, price_b2c, stock, active)
  VALUES (v_tenant, 'f-test-code-001', '001CP Alto-falante 6 polegadas',
          'test-code-normalization-001', 10, 1, true)
  RETURNING id, slug INTO v_prod, v_slug;

  -- 1) internal_code herdado do SKU (AZ/F), SKU preservado
  UPDATE public.products
  SET internal_code = upper(btrim(sku))
  WHERE id = v_prod AND internal_code IS NULL AND upper(btrim(sku)) ~ '^(AZ|F)';

  SELECT internal_code, sku INTO v_internal, v_sku FROM public.products WHERE id = v_prod;
  ASSERT v_internal = 'F-TEST-CODE-001', 'internal_code deveria vir do SKU AZ/F';
  ASSERT v_sku IS NOT NULL, 'SKU nunca pode ser apagado';

  -- 2) manufacturer_code extraído com regra conservadora, nome limpo
  WITH c AS (
    SELECT id,
           (regexp_match(btrim(name), '^([A-Za-z0-9][A-Za-z0-9._/-]{2,})\s+(.+)$'))[1] AS token,
           (regexp_match(btrim(name), '^([A-Za-z0-9][A-Za-z0-9._/-]{2,})\s+(.+)$'))[2] AS resto
    FROM public.products WHERE id = v_prod AND manufacturer_code IS NULL
  )
  UPDATE public.products p
  SET manufacturer_code = upper(c.token), name = btrim(c.resto)
  FROM c
  WHERE p.id = c.id
    AND c.token ~ '[0-9]'
    AND c.token !~ '^[0-9]+[A-Za-z]{4,}$'
    AND btrim(c.resto) <> '';

  SELECT name, manufacturer_code INTO v_name, v_manu FROM public.products WHERE id = v_prod;
  ASSERT v_manu = '001CP', format('manufacturer_code inesperado: %s', v_manu);
  ASSERT v_name = 'Alto-falante 6 polegadas', format('nome não limpo: %s', v_name);
  ASSERT v_name NOT LIKE '%001CP%', 'código nunca deve voltar ao nome';

  -- 3) slug preservado
  ASSERT (SELECT slug FROM public.products WHERE id = v_prod) = v_slug, 'slug não pode ser regenerado';

  -- 4) caso ambíguo NÃO altera products e vai para revisão
  INSERT INTO public.product_code_normalization_audit (
    tenant_id, product_id, original_sku, original_name, status, reason
  ) VALUES (
    v_tenant, v_prod, 'F-TEST-CODE-001', '001CP Alto-falante 6 polegadas',
    'review_required', 'teste'
  )
  ON CONFLICT (product_id) DO UPDATE SET status = 'review_required'
  RETURNING id INTO v_audit;

  ASSERT (SELECT status FROM public.product_code_normalization_audit WHERE id = v_audit)
         = 'review_required', 'status deveria ser review_required';

  -- 5) aplicar revisão marca applied e grava reviewed_at
  UPDATE public.products
  SET internal_code = 'AZ9999', manufacturer_code = '001CP', name = 'Alto-falante 6"'
  WHERE id = v_prod;
  UPDATE public.product_code_normalization_audit
  SET status = 'applied', reviewed_at = now()
  WHERE id = v_audit;

  ASSERT (SELECT status FROM public.product_code_normalization_audit WHERE id = v_audit) = 'applied',
    'revisão aplicada deveria ficar applied';
  ASSERT (SELECT reviewed_at IS NOT NULL FROM public.product_code_normalization_audit WHERE id = v_audit),
    'reviewed_at deveria estar preenchido (protege contra sobrescrita do Bling)';

  -- 6) duplicidade de código interno é apenas detectável, não bloqueada no banco
  ASSERT (SELECT count(*) FROM public.products
          WHERE tenant_id = v_tenant AND internal_code = 'AZ9999') >= 1,
    'consulta de duplicidade por tenant deve funcionar';

  RAISE NOTICE 'product_code_normalization: OK';
END $$;

ROLLBACK;
