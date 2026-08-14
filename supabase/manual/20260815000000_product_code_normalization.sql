-- =====================================================================
-- Saneamento definitivo dos códigos de produto (equivalente ao já
-- aplicado manualmente no Supabase DEV pleuoxzocgoajmymipqi).
--
-- Idempotente e NÃO destrutivo:
--   * nunca apaga SKU (compatibilidade Bling);
--   * nunca regenera slug (URLs preservadas);
--   * nunca sobrescreve internal_code / manufacturer_code já preenchidos;
--   * nunca sobrescreve linhas de auditoria já revisadas manualmente.
-- =====================================================================

-- 1) Colunas de código -------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS internal_code text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS manufacturer_code text;

CREATE INDEX IF NOT EXISTS products_internal_code_idx
  ON public.products (tenant_id, internal_code);
CREATE INDEX IF NOT EXISTS products_manufacturer_code_idx
  ON public.products (tenant_id, manufacturer_code);

-- Código do fabricante pode repetir entre marcas: sem unicidade global.
-- Código interno é apenas avisado como possível duplicidade na aplicação.

-- 2) Tabela de auditoria reversível -----------------------------------
CREATE TABLE IF NOT EXISTS public.product_code_normalization_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  original_sku text,
  original_name text,
  original_internal_code text,
  original_manufacturer_code text,
  proposed_name text,
  proposed_internal_code text,
  proposed_manufacturer_code text,
  status text NOT NULL DEFAULT 'applied',
  reason text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_code_normalization_audit
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.product_code_normalization_audit
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE public.product_code_normalization_audit
  ADD COLUMN IF NOT EXISTS reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_code_norm_audit_status_chk'
  ) THEN
    ALTER TABLE public.product_code_normalization_audit
      ADD CONSTRAINT product_code_norm_audit_status_chk
      CHECK (status IN ('applied', 'review_required', 'reverted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS product_code_norm_audit_status_idx
  ON public.product_code_normalization_audit (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS product_code_norm_audit_product_uk
  ON public.product_code_normalization_audit (product_id);

-- 3) Grants (Data API) -------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.product_code_normalization_audit TO authenticated;
GRANT ALL ON public.product_code_normalization_audit TO service_role;

-- 4) RLS por tenant ----------------------------------------------------
ALTER TABLE public.product_code_normalization_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "code_audit_select_staff" ON public.product_code_normalization_audit;
CREATE POLICY "code_audit_select_staff"
  ON public.product_code_normalization_audit FOR SELECT TO authenticated
  USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','stock']));

DROP POLICY IF EXISTS "code_audit_write_staff" ON public.product_code_normalization_audit;
CREATE POLICY "code_audit_write_staff"
  ON public.product_code_normalization_audit FOR UPDATE TO authenticated
  USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','stock']))
  WITH CHECK (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','stock']));

DROP POLICY IF EXISTS "code_audit_insert_staff" ON public.product_code_normalization_audit;
CREATE POLICY "code_audit_insert_staff"
  ON public.product_code_normalization_audit FOR INSERT TO authenticated
  WITH CHECK (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','stock']));

-- 5) Saneamento (snapshot + preenchimento) ----------------------------
-- 5.1 Snapshot dos produtos ainda não auditados.
INSERT INTO public.product_code_normalization_audit (
  tenant_id, product_id, original_sku, original_name,
  original_internal_code, original_manufacturer_code, status, reason
)
SELECT p.tenant_id, p.id, p.sku, p.name, p.internal_code, p.manufacturer_code,
       'applied', 'snapshot inicial'
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_code_normalization_audit a WHERE a.product_id = p.id
)
ON CONFLICT (product_id) DO NOTHING;

-- 5.2 internal_code herdado do SKU quando começa por AZ ou F.
UPDATE public.products
SET internal_code = upper(btrim(sku))
WHERE internal_code IS NULL
  AND sku IS NOT NULL
  AND upper(btrim(sku)) ~ '^(AZ|F)';

-- 5.3 manufacturer_code extraído do início do nome (regra conservadora):
--     token com dígito, delimitado por espaço, excluindo "número + 4+ letras".
WITH candidato AS (
  SELECT id,
         (regexp_match(btrim(name), '^([A-Za-z0-9][A-Za-z0-9._/-]{2,})\s+(.+)$'))[1] AS token,
         (regexp_match(btrim(name), '^([A-Za-z0-9][A-Za-z0-9._/-]{2,})\s+(.+)$'))[2] AS resto
  FROM public.products
  WHERE manufacturer_code IS NULL
)
UPDATE public.products p
SET manufacturer_code = upper(c.token),
    name = btrim(c.resto)
FROM candidato c
WHERE p.id = c.id
  AND c.token IS NOT NULL
  AND c.resto IS NOT NULL
  AND btrim(c.resto) <> ''
  AND c.token ~ '[0-9]'
  AND c.token !~ '^[0-9]+[A-Za-z]{4,}$';

-- 5.4 Casos ambíguos vão para revisão manual (token com dígito mas nome curto
--     ou padrão duvidoso). Não altera products.
UPDATE public.product_code_normalization_audit a
SET status = 'review_required',
    reason = COALESCE(a.reason, 'código de fabricante ambíguo no início do nome')
FROM public.products p
WHERE a.product_id = p.id
  AND a.status = 'applied'
  AND a.reviewed_at IS NULL
  AND p.manufacturer_code IS NULL
  AND btrim(p.name) ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{2,}\s'
  AND (regexp_match(btrim(p.name), '^([A-Za-z0-9][A-Za-z0-9._/-]{2,})\s'))[1] ~ '[0-9]';

-- 5.5 Normalização final dos códigos (trim + uppercase), sem apagar nada.
UPDATE public.products
SET sku = upper(btrim(sku))
WHERE sku IS NOT NULL AND sku <> upper(btrim(sku));

UPDATE public.products
SET internal_code = upper(btrim(internal_code))
WHERE internal_code IS NOT NULL AND internal_code <> upper(btrim(internal_code));

UPDATE public.products
SET manufacturer_code = upper(btrim(manufacturer_code))
WHERE manufacturer_code IS NOT NULL AND manufacturer_code <> upper(btrim(manufacturer_code));

-- slug NÃO é regenerado em nenhuma etapa.
