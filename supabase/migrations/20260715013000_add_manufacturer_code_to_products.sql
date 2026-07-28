-- Separa o código do fabricante da descrição comercial do produto.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS manufacturer_code TEXT;

CREATE INDEX IF NOT EXISTS idx_products_manufacturer_code
  ON public.products (manufacturer_code)
  WHERE manufacturer_code IS NOT NULL;

-- Migração conservadora: considera código apenas o primeiro bloco com
-- pelo menos 3 caracteres e ao menos um número (ex.: 001CP, ABC-123).
WITH parsed AS (
  SELECT
    id,
    regexp_match(
      btrim(name),
      '^([[:alnum:]][[:alnum:]./_-]{2,})[[:space:]]+(.+)$'
    ) AS parts
  FROM public.products
  WHERE manufacturer_code IS NULL
)
UPDATE public.products AS product
SET
  manufacturer_code = upper(parsed.parts[1]),
  name = btrim(parsed.parts[2]),
  updated_at = now()
FROM parsed
WHERE product.id = parsed.id
  AND parsed.parts IS NOT NULL
  AND parsed.parts[1] ~ '[0-9]';

COMMENT ON COLUMN public.products.manufacturer_code IS
  'Código original da peça informado pelo fabricante, separado do SKU e do código interno.';
