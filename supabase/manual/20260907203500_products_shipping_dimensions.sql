-- Dimensões de frete no catálogo oficial (peso já existia em products.weight_kg).
-- Colunas opcionais no legado: NULL permitido, mas quando preenchidas devem ser > 0.
-- Aplicar manualmente no projeto Supabase (supabase/migrations é gerenciado pela plataforma).

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS height_cm numeric(10,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS width_cm numeric(10,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS length_cm numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_height_cm_positive'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_height_cm_positive CHECK (height_cm IS NULL OR height_cm > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_width_cm_positive'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_width_cm_positive CHECK (width_cm IS NULL OR width_cm > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass AND conname = 'products_length_cm_positive'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_length_cm_positive CHECK (length_cm IS NULL OR length_cm > 0);
  END IF;
END
$$;

-- O cálculo público de frete precisa ler as dimensões junto do peso.
GRANT SELECT (height_cm, width_cm, length_cm) ON public.products TO anon;
GRANT SELECT (height_cm, width_cm, length_cm) ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
