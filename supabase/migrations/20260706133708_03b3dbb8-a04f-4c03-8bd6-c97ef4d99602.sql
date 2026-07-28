
-- === Helpers ===
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

-- === Products: novos campos ===
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS internal_code text,
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS sale_price_b2c numeric(12,2),
  ADD COLUMN IF NOT EXISTS sale_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_new boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_bestseller boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hide_when_out_of_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_stock integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

-- === Banners: novos campos ===
DO $$ BEGIN
  CREATE TYPE public.banner_audience AS ENUM ('all','b2c','b2b');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.banners
  ADD COLUMN IF NOT EXISTS image_mobile_url text,
  ADD COLUMN IF NOT EXISTS audience public.banner_audience NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- === Sales reps: novos campos ===
ALTER TABLE public.sales_reps
  ADD COLUMN IF NOT EXISTS max_discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_sell_b2b boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_create_customer boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- === Bling config: flags ===
ALTER TABLE public.bling_config
  ADD COLUMN IF NOT EXISTS sync_prices boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sync_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hide_out_of_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_overwrites_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_price_overrides boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_sync_cron text,
  ADD COLUMN IF NOT EXISTS last_authorized_at timestamptz;

-- === Promotions ===
DO $$ BEGIN
  CREATE TYPE public.promotion_type AS ENUM ('product','category','brand','customer_group');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.discount_type AS ENUM ('percentage','fixed_amount','special_price');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  promotion_type public.promotion_type NOT NULL,
  discount_type public.discount_type NOT NULL,
  discount_value numeric(12,2) NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  customer_group text,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.promotions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.promotions TO authenticated;
GRANT ALL ON public.promotions TO service_role;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Promotions readable by all" ON public.promotions FOR SELECT USING (true);
CREATE POLICY "Promotions managed by staff" ON public.promotions FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER promotions_set_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- === Coupons ===
DO $$ BEGIN
  CREATE TYPE public.coupon_discount_type AS ENUM ('percentage','fixed_amount');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  discount_type public.coupon_discount_type NOT NULL,
  discount_value numeric(12,2) NOT NULL,
  min_order_value numeric(12,2),
  max_discount_value numeric(12,2),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer,
  usage_limit_per_user integer,
  first_purchase_only boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  customer_group text,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.coupons TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coupons readable by staff" ON public.coupons FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Coupons managed by staff" ON public.coupons FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER coupons_set_updated_at BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.coupon_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  discount_amount numeric(12,2) NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.coupon_usages TO authenticated;
GRANT ALL ON public.coupon_usages TO service_role;
ALTER TABLE public.coupon_usages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own coupon usages" ON public.coupon_usages FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "Users insert own coupon usages" ON public.coupon_usages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- === AI A&S Business config ===
CREATE TABLE IF NOT EXISTS public.ai_aes_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_url text,
  active boolean NOT NULL DEFAULT false,
  allowed_scopes text[] NOT NULL DEFAULT ARRAY['products','categories','policies']::text[],
  last_tested_at timestamptz,
  last_test_status text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_aes_config TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ai_aes_config TO authenticated;
GRANT ALL ON public.ai_aes_config TO service_role;
ALTER TABLE public.ai_aes_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AI cfg admin only" ON public.ai_aes_config FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER ai_aes_config_set_updated_at BEFORE UPDATE ON public.ai_aes_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed single row
INSERT INTO public.ai_aes_config (id) SELECT gen_random_uuid() WHERE NOT EXISTS (SELECT 1 FROM public.ai_aes_config);

-- === Bling config: restringir a admin ===
DROP POLICY IF EXISTS "Bling cfg staff" ON public.bling_config;
CREATE POLICY "Bling cfg admin only" ON public.bling_config FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
