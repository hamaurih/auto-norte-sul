
-- =========================================================================
-- 1. NEW ENUMS: customer_group + b2b_approval_status
-- =========================================================================
DO $$ BEGIN
  CREATE TYPE public.customer_group AS ENUM ('b2c','b2b_pendente','revendedor','oficina','distribuidor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.b2b_approval_status AS ENUM ('none','pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- 2. PROFILES: add customer_group + b2b_status
-- =========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS customer_group public.customer_group NOT NULL DEFAULT 'b2c',
  ADD COLUMN IF NOT EXISTS b2b_status public.b2b_approval_status NOT NULL DEFAULT 'none';

-- Backfill from existing user_roles
UPDATE public.profiles p SET
  customer_group = CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = 'distribuidor') THEN 'distribuidor'::public.customer_group
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = 'oficina') THEN 'oficina'::public.customer_group
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = 'revendedor') THEN 'revendedor'::public.customer_group
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = 'b2b_pendente') THEN 'b2b_pendente'::public.customer_group
    ELSE 'b2c'::public.customer_group
  END,
  b2b_status = CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text IN ('revendedor','oficina','distribuidor')) THEN 'approved'::public.b2b_approval_status
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = 'b2b_pendente') THEN 'pending'::public.b2b_approval_status
    ELSE 'none'::public.b2b_approval_status
  END;

-- =========================================================================
-- 3. REWORK app_role ENUM  →  admin, gerente, vendedor, cliente
-- =========================================================================
-- Drop dependent policies (they use is_staff/has_role helpers -> safe to keep).
-- We only need to drop functions that reference app_role directly, then re-add.

ALTER TYPE public.app_role RENAME TO app_role_old;

CREATE TYPE public.app_role AS ENUM ('admin','gerente','vendedor','cliente');

-- Drop old helper functions that depend on app_role_old
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role_old);

-- Migrate user_roles.role column
ALTER TABLE public.user_roles
  ALTER COLUMN role TYPE public.app_role
  USING (
    CASE role::text
      WHEN 'admin' THEN 'admin'
      WHEN 'gerente' THEN 'gerente'
      ELSE 'cliente'
    END
  )::public.app_role;

-- Collapse duplicates that appeared after mapping
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.ctid < b.ctid AND a.user_id = b.user_id AND a.role = b.role;

DROP TYPE public.app_role_old;

-- =========================================================================
-- 4. HELPER FUNCTIONS
-- =========================================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','gerente'));
$$;

CREATE OR REPLACE FUNCTION public.is_sales_rep(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'vendedor');
$$;

CREATE OR REPLACE FUNCTION public.is_b2b_approved(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id
      AND customer_group IN ('revendedor','oficina','distribuidor')
      AND b2b_status = 'approved'
  ) OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','gerente'));
$$;

-- New-user trigger: cliente + b2c
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, customer_group, b2b_status)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), 'b2c', 'none')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cliente') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

-- B2B request trigger: profile → b2b_pendente/pending
CREATE OR REPLACE FUNCTION public.handle_new_b2b_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
     SET customer_group = 'b2b_pendente',
         b2b_status = 'pending'
   WHERE id = NEW.user_id;
  RETURN NEW;
END; $$;

-- =========================================================================
-- 5. SALES REPS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.sales_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  active boolean NOT NULL DEFAULT true,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  notes text,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_reps TO authenticated;
GRANT ALL ON public.sales_reps TO service_role;
ALTER TABLE public.sales_reps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_reps_staff_all" ON public.sales_reps FOR ALL
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "sales_reps_self_read" ON public.sales_reps FOR SELECT
  USING (auth.uid() = user_id);
CREATE TRIGGER trg_sales_reps_updated_at BEFORE UPDATE ON public.sales_reps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 6. SALES REP ↔ CUSTOMER CARTEIRA
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.sales_rep_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id uuid NOT NULL REFERENCES public.sales_reps(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_name text,
  lead_email text,
  lead_phone text,
  lead_cnpj text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_rep_customers_has_target CHECK (customer_id IS NOT NULL OR lead_name IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_rep_customers TO authenticated;
GRANT ALL ON public.sales_rep_customers TO service_role;
ALTER TABLE public.sales_rep_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "src_staff_all" ON public.sales_rep_customers FOR ALL
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "src_rep_read" ON public.sales_rep_customers FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = rep_id AND sr.user_id = auth.uid()));
CREATE POLICY "src_rep_write" ON public.sales_rep_customers FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = rep_id AND sr.user_id = auth.uid()));
CREATE POLICY "src_rep_update" ON public.sales_rep_customers FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = rep_id AND sr.user_id = auth.uid()));
CREATE TRIGGER trg_src_updated_at BEFORE UPDATE ON public.sales_rep_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 7. SALES ORDERS (pedido assistido)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id uuid NOT NULL REFERENCES public.sales_reps(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_name text,
  lead_email text,
  lead_phone text,
  lead_cnpj text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'rascunho',
  notes text,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_orders TO authenticated;
GRANT ALL ON public.sales_orders TO service_role;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "so_staff_all" ON public.sales_orders FOR ALL
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "so_rep_read" ON public.sales_orders FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = rep_id AND sr.user_id = auth.uid()));
CREATE POLICY "so_rep_insert" ON public.sales_orders FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = rep_id AND sr.user_id = auth.uid()));
CREATE POLICY "so_rep_update" ON public.sales_orders FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = rep_id AND sr.user_id = auth.uid()));
CREATE TRIGGER trg_so_updated_at BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 8. AI CHAT SESSIONS + MESSAGES + TOOL LOGS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.ai_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  page_context text,
  user_type text,
  customer_group text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chat_sessions TO authenticated;
GRANT ALL ON public.ai_chat_sessions TO service_role;
ALTER TABLE public.ai_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_sessions_own" ON public.ai_chat_sessions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chat_sessions_staff_read" ON public.ai_chat_sessions FOR SELECT
  USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_ai_sessions_updated_at BEFORE UPDATE ON public.ai_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.ai_chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content text NOT NULL,
  suggestions jsonb,
  recommended_action jsonb,
  tokens_in int,
  tokens_out int,
  latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chat_messages TO authenticated;
GRANT ALL ON public.ai_chat_messages TO service_role;
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_msgs_own" ON public.ai_chat_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM public.ai_chat_sessions s WHERE s.id = session_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_chat_sessions s WHERE s.id = session_id AND s.user_id = auth.uid()));
CREATE POLICY "chat_msgs_staff_read" ON public.ai_chat_messages FOR SELECT
  USING (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ai_tool_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.ai_chat_sessions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  input jsonb,
  output jsonb,
  status text NOT NULL DEFAULT 'ok',
  error text,
  latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_tool_logs TO authenticated;
GRANT ALL ON public.ai_tool_logs TO service_role;
ALTER TABLE public.ai_tool_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_tool_logs_staff_read" ON public.ai_tool_logs FOR SELECT
  USING (public.is_staff(auth.uid()));
CREATE POLICY "ai_tool_logs_own_read" ON public.ai_tool_logs FOR SELECT
  USING (auth.uid() = user_id);
