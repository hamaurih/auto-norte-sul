
-- =========================================================
-- 1. Private schema for RLS helper functions
-- =========================================================
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Move helpers to private (recreate, then drop public originals AFTER policies updated)
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION private.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION private.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','gerente'));
$$;

CREATE OR REPLACE FUNCTION private.is_b2b_approved(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id
      AND customer_group IN ('revendedor','oficina','distribuidor')
      AND b2b_status = 'approved'
  ) OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','gerente'));
$$;

CREATE OR REPLACE FUNCTION private.is_sales_rep(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'vendedor');
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_b2b_approved(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_sales_rep(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_b2b_approved(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_sales_rep(uuid) TO authenticated, service_role;

-- =========================================================
-- 2. Rewrite every policy referencing public.is_staff / is_admin / etc.
-- =========================================================

-- ai_aes_config
DROP POLICY IF EXISTS "AI cfg admin only" ON public.ai_aes_config;
CREATE POLICY "AI cfg admin only" ON public.ai_aes_config FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

-- ai_chat_messages
DROP POLICY IF EXISTS chat_msgs_staff_read ON public.ai_chat_messages;
CREATE POLICY chat_msgs_staff_read ON public.ai_chat_messages FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));

-- ai_chat_sessions
DROP POLICY IF EXISTS chat_sessions_staff_read ON public.ai_chat_sessions;
CREATE POLICY chat_sessions_staff_read ON public.ai_chat_sessions FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));

-- ai_knowledge_base
DROP POLICY IF EXISTS kb_staff_all ON public.ai_knowledge_base;
CREATE POLICY kb_staff_all ON public.ai_knowledge_base FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- ai_product_embeddings
DROP POLICY IF EXISTS embeddings_staff_read ON public.ai_product_embeddings;
CREATE POLICY embeddings_staff_read ON public.ai_product_embeddings FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));

-- ai_tool_logs
DROP POLICY IF EXISTS ai_tool_logs_staff_read ON public.ai_tool_logs;
CREATE POLICY ai_tool_logs_staff_read ON public.ai_tool_logs FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));

-- b2b_registrations
DROP POLICY IF EXISTS b2b_staff_all ON public.b2b_registrations;
CREATE POLICY b2b_staff_all ON public.b2b_registrations FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- Fix: b2b_self_update_pending — add WITH CHECK preventing status/notes tampering
DROP POLICY IF EXISTS b2b_self_update_pending ON public.b2b_registrations;
CREATE POLICY b2b_self_update_pending ON public.b2b_registrations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'pendente')
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pendente'
    AND admin_notes IS NULL
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

-- banners
DROP POLICY IF EXISTS banners_staff_all ON public.banners;
CREATE POLICY banners_staff_all ON public.banners FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- bling_config
DROP POLICY IF EXISTS bling_config_staff_read ON public.bling_config;
CREATE POLICY bling_config_staff_read ON public.bling_config FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Bling cfg admin only" ON public.bling_config;
CREATE POLICY "Bling cfg admin only" ON public.bling_config FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

-- bling_sync_logs
DROP POLICY IF EXISTS sync_logs_staff_read ON public.bling_sync_logs;
CREATE POLICY sync_logs_staff_read ON public.bling_sync_logs FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));

-- brands
DROP POLICY IF EXISTS brands_staff_write ON public.brands;
CREATE POLICY brands_staff_write ON public.brands FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- categories
DROP POLICY IF EXISTS categories_staff_write ON public.categories;
CREATE POLICY categories_staff_write ON public.categories FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));
DROP POLICY IF EXISTS categories_staff_read ON public.categories;
CREATE POLICY categories_staff_read ON public.categories FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));

-- coupon_usages
DROP POLICY IF EXISTS "Users see own coupon usages" ON public.coupon_usages;
CREATE POLICY "Users see own coupon usages" ON public.coupon_usages FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.is_staff(auth.uid()));

-- coupons
DROP POLICY IF EXISTS "Coupons readable by staff" ON public.coupons;
CREATE POLICY "Coupons readable by staff" ON public.coupons FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Coupons managed by staff" ON public.coupons;
CREATE POLICY "Coupons managed by staff" ON public.coupons FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- storage.objects (banners + product-images)
DROP POLICY IF EXISTS "staff write banners" ON storage.objects;
CREATE POLICY "staff write banners" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'banners' AND private.is_staff(auth.uid()))
  WITH CHECK (bucket_id = 'banners' AND private.is_staff(auth.uid()));
DROP POLICY IF EXISTS "staff write product-images" ON storage.objects;
CREATE POLICY "staff write product-images" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'product-images' AND private.is_staff(auth.uid()))
  WITH CHECK (bucket_id = 'product-images' AND private.is_staff(auth.uid()));

-- order_items
DROP POLICY IF EXISTS order_items_staff_all ON public.order_items;
CREATE POLICY order_items_staff_all ON public.order_items FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- orders
DROP POLICY IF EXISTS orders_staff_all ON public.orders;
CREATE POLICY orders_staff_all ON public.orders FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- product_applications
DROP POLICY IF EXISTS applications_staff_write ON public.product_applications;
CREATE POLICY applications_staff_write ON public.product_applications FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- product_images
DROP POLICY IF EXISTS product_images_staff_write ON public.product_images;
CREATE POLICY product_images_staff_write ON public.product_images FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- products
DROP POLICY IF EXISTS products_staff_read ON public.products;
CREATE POLICY products_staff_read ON public.products FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));
DROP POLICY IF EXISTS products_staff_write ON public.products;
CREATE POLICY products_staff_write ON public.products FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- promotions
DROP POLICY IF EXISTS "Promotions managed by staff" ON public.promotions;
CREATE POLICY "Promotions managed by staff" ON public.promotions FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- sales_orders
DROP POLICY IF EXISTS so_staff_all ON public.sales_orders;
CREATE POLICY so_staff_all ON public.sales_orders FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- Fix: so_rep_update — add matching WITH CHECK to prevent reassignment
DROP POLICY IF EXISTS so_rep_update ON public.sales_orders;
CREATE POLICY so_rep_update ON public.sales_orders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = sales_orders.rep_id AND sr.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = sales_orders.rep_id AND sr.user_id = auth.uid()));

-- sales_rep_customers
DROP POLICY IF EXISTS src_staff_all ON public.sales_rep_customers;
CREATE POLICY src_staff_all ON public.sales_rep_customers FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- Fix: src_rep_update — add matching WITH CHECK
DROP POLICY IF EXISTS src_rep_update ON public.sales_rep_customers;
CREATE POLICY src_rep_update ON public.sales_rep_customers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = sales_rep_customers.rep_id AND sr.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = sales_rep_customers.rep_id AND sr.user_id = auth.uid()));

-- sales_reps
DROP POLICY IF EXISTS sales_reps_staff_all ON public.sales_reps;
CREATE POLICY sales_reps_staff_all ON public.sales_reps FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));

-- user_roles
DROP POLICY IF EXISTS roles_staff_write ON public.user_roles;
CREATE POLICY roles_staff_write ON public.user_roles FOR ALL TO authenticated
  USING (private.is_staff(auth.uid())) WITH CHECK (private.is_staff(auth.uid()));
DROP POLICY IF EXISTS roles_staff_read ON public.user_roles;
CREATE POLICY roles_staff_read ON public.user_roles FOR SELECT TO authenticated
  USING (private.is_staff(auth.uid()));

-- =========================================================
-- 3. Drop old public helper functions now that no policy references them
-- =========================================================
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.is_admin(uuid);
DROP FUNCTION IF EXISTS public.is_staff(uuid);
DROP FUNCTION IF EXISTS public.is_b2b_approved(uuid);
DROP FUNCTION IF EXISTS public.is_sales_rep(uuid);

-- =========================================================
-- 4. Lock down trigger-only functions in public
-- =========================================================
-- set_updated_at: add fixed search_path
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_b2b_registration() FROM PUBLIC, anon, authenticated;
