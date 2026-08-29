-- Phase 1 — Single ERP core.
-- Norte Sul ERP is the sole source of truth for catalog, pricing, stock, orders and customers.
-- External systems (Bling/marketplaces/etc.) are adapters only.

-- -----------------------------------------------------------------------------
-- 1. Explicit source-of-truth contract per tenant
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_core_sources (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  products_source text NOT NULL DEFAULT 'erp' CHECK (products_source = 'erp'),
  prices_source text NOT NULL DEFAULT 'erp' CHECK (prices_source = 'erp'),
  stock_source text NOT NULL DEFAULT 'product_stock' CHECK (stock_source = 'product_stock'),
  orders_source text NOT NULL DEFAULT 'erp' CHECK (orders_source = 'erp'),
  customers_source text NOT NULL DEFAULT 'erp' CHECK (customers_source = 'erp'),
  authorization_source text NOT NULL DEFAULT 'tenant_memberships' CHECK (authorization_source = 'tenant_memberships'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.erp_core_sources (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE public.erp_core_sources ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.erp_core_sources TO authenticated;
GRANT ALL ON public.erp_core_sources TO service_role;
DROP POLICY IF EXISTS "ERP core sources tenant read" ON public.erp_core_sources;
CREATE POLICY "ERP core sources tenant read"
ON public.erp_core_sources FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','stock','sales','cashier','finance','accountant','support','viewer']::text[]));

-- Make the storefront resolver usable for every tenant. The client already sends
-- x-tenant-slug; this row is the mapping used by public RLS.
INSERT INTO public.tenant_storefronts (tenant_id, slug, active)
SELECT id, slug, true FROM public.tenants
ON CONFLICT (slug) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, active = true, updated_at = now();

-- -----------------------------------------------------------------------------
-- 2. Tenantize every business table that still contained global operational data
-- -----------------------------------------------------------------------------
ALTER TABLE public.ai_aes_config ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ai_chat_messages ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ai_chat_sessions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ai_knowledge_base ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ai_product_embeddings ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.ai_tool_logs ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.b2b_registrations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.banners ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.bling_config ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.bling_sync_logs ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.coupon_usages ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.integration_logs ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.oauth_authorization_states ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.search_aliases ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.search_no_result_logs ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant
  FROM public.tenants
  WHERE environment = 'production'
  ORDER BY created_at
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Phase 1 requires one production tenant for legacy-row backfill';
  END IF;

  UPDATE public.ai_aes_config SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.ai_chat_messages SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.ai_chat_sessions SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.ai_knowledge_base SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.ai_product_embeddings SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.ai_tool_logs SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.b2b_registrations SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.banners SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.bling_config SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.bling_sync_logs SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.coupon_usages SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.coupons SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.integration_logs SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.integration_settings SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.oauth_authorization_states SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.promotions SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.search_aliases SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.search_no_result_logs SET tenant_id = v_tenant WHERE tenant_id IS NULL;
END $$;

ALTER TABLE public.ai_aes_config ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.ai_chat_messages ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.ai_chat_sessions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.ai_knowledge_base ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.ai_product_embeddings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.ai_tool_logs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.b2b_registrations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.banners ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.bling_config ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.bling_sync_logs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.coupon_usages ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.coupons ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.integration_logs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.integration_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.oauth_authorization_states ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.promotions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.search_aliases ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.search_no_result_logs ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_aes_config_tenant ON public.ai_aes_config(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_tenant ON public.ai_chat_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_tenant ON public.ai_chat_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_base_tenant ON public.ai_knowledge_base(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_product_embeddings_tenant ON public.ai_product_embeddings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_tool_logs_tenant ON public.ai_tool_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_b2b_registrations_tenant ON public.b2b_registrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_banners_tenant ON public.banners(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bling_config_tenant ON public.bling_config(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bling_sync_logs_tenant ON public.bling_sync_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_tenant ON public.coupon_usages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON public.coupons(tenant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_tenant ON public.oauth_authorization_states(tenant_id);
CREATE INDEX IF NOT EXISTS idx_promotions_tenant ON public.promotions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_aliases_tenant ON public.search_aliases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_no_result_logs_tenant ON public.search_no_result_logs(tenant_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Global integration definitions vs tenant operational state
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_integration_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  status public.integration_status NOT NULL DEFAULT 'disconnected',
  active boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, integration_id)
);

INSERT INTO public.tenant_integration_states (tenant_id, integration_id)
SELECT t.id, i.id FROM public.tenants t CROSS JOIN public.integrations i
ON CONFLICT (tenant_id, integration_id) DO NOTHING;

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.integration_settings'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%(integration_id, key)%'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%tenant_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.integration_settings DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_settings_tenant_key
  ON public.integration_settings(tenant_id, integration_id, key);
CREATE INDEX IF NOT EXISTS idx_integration_logs_tenant
  ON public.integration_logs(tenant_id, integration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_integration_states_tenant
  ON public.tenant_integration_states(tenant_id, integration_id);

COMMENT ON TABLE public.integrations IS 'Global provider catalog only. Tenant-specific status/configuration lives in tenant_integration_states/integration_settings.';
COMMENT ON COLUMN public.integrations.active IS 'LEGACY compatibility field; do not use as tenant state.';
COMMENT ON COLUMN public.integrations.status IS 'LEGACY compatibility field; do not use as tenant state.';
COMMENT ON COLUMN public.integrations.last_sync_at IS 'LEGACY compatibility field; do not use as tenant state.';

-- Bling source-of-truth switches are permanently disabled. Kept only for schema compatibility.
UPDATE public.bling_config
SET source_products = false,
    source_stock = false,
    source_price_b2c = false,
    updated_at = now();

ALTER TABLE public.bling_config DROP CONSTRAINT IF EXISTS bling_config_erp_is_master;
ALTER TABLE public.bling_config ADD CONSTRAINT bling_config_erp_is_master
  CHECK (source_products = false AND source_stock = false AND source_price_b2c = false);
COMMENT ON COLUMN public.bling_config.source_products IS 'Deprecated. ERP is always the product source of truth; must remain false.';
COMMENT ON COLUMN public.bling_config.source_stock IS 'Deprecated. product_stock is always the stock source of truth; must remain false.';
COMMENT ON COLUMN public.bling_config.source_price_b2c IS 'Deprecated. ERP is always the price source of truth; must remain false.';

-- -----------------------------------------------------------------------------
-- 4. Canonical external ID mapping for Bling and every marketplace
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.external_entity_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (char_length(entity_type) BETWEEN 1 AND 80),
  internal_id text NOT NULL CHECK (char_length(internal_id) BETWEEN 1 AND 200),
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 300),
  external_parent_id text,
  external_account_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, integration_id, entity_type, internal_id),
  UNIQUE (tenant_id, integration_id, entity_type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_external_entity_mappings_lookup
  ON public.external_entity_mappings(tenant_id, integration_id, entity_type, external_id);

INSERT INTO public.external_entity_mappings (tenant_id, integration_id, entity_type, internal_id, external_id)
SELECT p.tenant_id, i.id, 'product', p.id::text, p.bling_id
FROM public.products p
JOIN public.integrations i ON i.slug = 'bling'
WHERE p.bling_id IS NOT NULL AND p.bling_id <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.external_entity_mappings (tenant_id, integration_id, entity_type, internal_id, external_id)
SELECT b.tenant_id, i.id, 'brand', b.id::text, b.bling_id
FROM public.brands b
JOIN public.integrations i ON i.slug = 'bling'
WHERE b.bling_id IS NOT NULL AND b.bling_id <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.external_entity_mappings (tenant_id, integration_id, entity_type, internal_id, external_id)
SELECT c.tenant_id, i.id, 'category', c.id::text, c.bling_id
FROM public.categories c
JOIN public.integrations i ON i.slug = 'bling'
WHERE c.bling_id IS NOT NULL AND c.bling_id <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.external_entity_mappings (tenant_id, integration_id, entity_type, internal_id, external_id, metadata)
SELECT o.tenant_id, i.id, 'order', o.id::text, o.bling_id,
       jsonb_strip_nulls(jsonb_build_object('bling_number', o.bling_number))
FROM public.orders o
JOIN public.integrations i ON i.slug = 'bling'
WHERE o.bling_id IS NOT NULL AND o.bling_id <> ''
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.products.bling_id IS 'LEGACY compatibility cache. Canonical external IDs live in external_entity_mappings.';
COMMENT ON COLUMN public.brands.bling_id IS 'LEGACY compatibility cache. Canonical external IDs live in external_entity_mappings.';
COMMENT ON COLUMN public.categories.bling_id IS 'LEGACY compatibility cache. Canonical external IDs live in external_entity_mappings.';
COMMENT ON COLUMN public.orders.bling_id IS 'LEGACY compatibility cache. Canonical external IDs live in external_entity_mappings.';

-- -----------------------------------------------------------------------------
-- 5. Standard integration envelope: events, idempotency, attempts/logs and audit
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 160),
  aggregate_type text,
  aggregate_id text,
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  causation_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','success','error','dead_letter','skipped')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, integration_id, direction, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_integration_events_queue
  ON public.integration_events(tenant_id, integration_id, status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_integration_events_aggregate
  ON public.integration_events(tenant_id, aggregate_type, aggregate_id, created_at DESC);

ALTER TABLE public.integration_logs ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.integration_events(id) ON DELETE SET NULL;
ALTER TABLE public.integration_logs ADD COLUMN IF NOT EXISTS attempt_no integer NOT NULL DEFAULT 1;
ALTER TABLE public.integration_logs ADD COLUMN IF NOT EXISTS response jsonb;
ALTER TABLE public.integration_logs ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE public.integration_logs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE public.bling_sync_logs ADD COLUMN IF NOT EXISTS integration_event_id uuid REFERENCES public.integration_events(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION private.integration_log_event_bridge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF NEW.event_id IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.integration_events (
    tenant_id, integration_id, direction, event_type, aggregate_type, aggregate_id,
    idempotency_key, status, payload, error_message
  ) VALUES (
    NEW.tenant_id,
    NEW.integration_id,
    'outbound',
    NEW.event_type,
    'integration',
    COALESCE(NEW.external_id, NEW.integration_id::text),
    COALESCE(NULLIF(NEW.external_id,''), gen_random_uuid()::text),
    CASE NEW.status::text
      WHEN 'success' THEN 'success'
      WHEN 'error' THEN 'error'
      WHEN 'warning' THEN 'skipped'
      ELSE 'pending'
    END,
    COALESCE(NEW.payload, '{}'::jsonb),
    CASE WHEN NEW.status::text = 'error' THEN NEW.message ELSE NULL END
  ) RETURNING id INTO v_event_id;
  NEW.event_id := v_event_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.integration_log_event_bridge() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_integration_log_event_bridge ON public.integration_logs;
CREATE TRIGGER trg_integration_log_event_bridge
BEFORE INSERT ON public.integration_logs
FOR EACH ROW EXECUTE FUNCTION private.integration_log_event_bridge();

CREATE OR REPLACE FUNCTION private.bling_log_event_bridge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_integration_id uuid;
  v_event_id uuid;
BEGIN
  IF NEW.integration_event_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_integration_id FROM public.integrations WHERE slug = 'bling' LIMIT 1;
  IF v_integration_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.integration_events (
    tenant_id, integration_id, direction, event_type, aggregate_type, aggregate_id,
    status, payload, error_message
  ) VALUES (
    NEW.tenant_id,
    v_integration_id,
    'outbound',
    'bling.' || NEW.entity::text || '.' || NEW.action,
    NEW.entity::text,
    NEW.entity_id,
    CASE NEW.status::text WHEN 'sucesso' THEN 'success' WHEN 'erro' THEN 'error' ELSE 'pending' END,
    COALESCE(NEW.payload, '{}'::jsonb),
    CASE WHEN NEW.status::text = 'erro' THEN NEW.message ELSE NULL END
  ) RETURNING id INTO v_event_id;
  NEW.integration_event_id := v_event_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.bling_log_event_bridge() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bling_log_event_bridge ON public.bling_sync_logs;
CREATE TRIGGER trg_bling_log_event_bridge
BEFORE INSERT ON public.bling_sync_logs
FOR EACH ROW EXECUTE FUNCTION private.bling_log_event_bridge();

CREATE OR REPLACE FUNCTION private.audit_tenant_resource_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_organization_id uuid;
  v_resource_id text;
BEGIN
  v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  SELECT organization_id INTO v_organization_id FROM public.tenants WHERE id = v_tenant_id;
  IF v_organization_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  v_resource_id := COALESCE(NEW.id::text, OLD.id::text);
  INSERT INTO public.audit_events (
    organization_id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    v_organization_id,
    v_tenant_id,
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    v_resource_id,
    jsonb_build_object('operation', TG_OP, 'source', 'database_trigger')
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION private.audit_tenant_resource_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_integration_states','integration_settings','bling_config','external_entity_mappings']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_tenant_resource ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_tenant_resource AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.audit_tenant_resource_change()', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 6. product_stock is the only stock source of truth
-- -----------------------------------------------------------------------------
INSERT INTO public.product_stock (tenant_id, product_id, warehouse_id, on_hand, reserved, min_stock)
SELECT p.tenant_id, p.id, w.id, GREATEST(COALESCE(p.stock,0),0), 0, GREATEST(COALESCE(p.min_stock,0),0)
FROM public.products p
JOIN LATERAL (
  SELECT w1.id
  FROM public.warehouses w1
  WHERE w1.tenant_id = p.tenant_id AND w1.active
  ORDER BY w1.is_default DESC, w1.created_at ASC
  LIMIT 1
) w ON true
ON CONFLICT (tenant_id, product_id, warehouse_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.refresh_product_stock_cache(p_tenant_id uuid, p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_available integer;
BEGIN
  SELECT COALESCE(sum(GREATEST(on_hand - reserved, 0)),0)::integer
    INTO v_available
  FROM public.product_stock
  WHERE tenant_id = p_tenant_id AND product_id = p_product_id;

  PERFORM set_config('norte_sul.stock_cache_sync','1',true);
  UPDATE public.products SET stock = v_available
  WHERE tenant_id = p_tenant_id AND id = p_product_id;
  PERFORM set_config('norte_sul.stock_cache_sync','0',true);
END;
$$;
REVOKE ALL ON FUNCTION private.refresh_product_stock_cache(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.sync_product_stock_cache_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.refresh_product_stock_cache(COALESCE(NEW.tenant_id, OLD.tenant_id), COALESCE(NEW.product_id, OLD.product_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION private.sync_product_stock_cache_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_product_stock_sync_cache ON public.product_stock;
CREATE TRIGGER trg_product_stock_sync_cache
AFTER INSERT OR UPDATE OF on_hand, reserved OR DELETE ON public.product_stock
FOR EACH ROW EXECUTE FUNCTION private.sync_product_stock_cache_trigger();

CREATE OR REPLACE FUNCTION private.prevent_direct_product_stock_cache_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.stock IS DISTINCT FROM OLD.stock
     AND COALESCE(current_setting('norte_sul.stock_cache_sync', true),'0') <> '1' THEN
    RAISE EXCEPTION 'products.stock is a compatibility cache; update product_stock/adjust_product_stock instead';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_stock_cache_guard ON public.products;
CREATE TRIGGER trg_products_stock_cache_guard
BEFORE UPDATE OF stock ON public.products
FOR EACH ROW EXECUTE FUNCTION private.prevent_direct_product_stock_cache_write();

CREATE OR REPLACE FUNCTION private.seed_product_stock_after_product_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_warehouse uuid;
BEGIN
  SELECT id INTO v_warehouse
  FROM public.warehouses
  WHERE tenant_id = NEW.tenant_id AND active
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;
  IF v_warehouse IS NOT NULL THEN
    INSERT INTO public.product_stock (tenant_id,product_id,warehouse_id,on_hand,reserved,min_stock)
    VALUES (NEW.tenant_id,NEW.id,v_warehouse,GREATEST(COALESCE(NEW.stock,0),0),0,GREATEST(COALESCE(NEW.min_stock,0),0))
    ON CONFLICT (tenant_id,product_id,warehouse_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.seed_product_stock_after_product_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_products_seed_product_stock ON public.products;
CREATE TRIGGER trg_products_seed_product_stock
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION private.seed_product_stock_after_product_insert();

CREATE OR REPLACE VIEW public.v_product_stock_available
WITH (security_invoker = true)
AS
SELECT
  p.tenant_id,
  p.id AS product_id,
  COALESCE(sum(GREATEST(ps.on_hand - ps.reserved, 0)),0)::integer AS available_multi,
  COALESCE(sum(ps.on_hand),0)::integer AS on_hand_multi,
  COALESCE(sum(ps.reserved),0)::integer AS reserved_multi,
  p.stock AS legacy_stock,
  COALESCE(sum(GREATEST(ps.on_hand - ps.reserved, 0)),0)::integer AS available_effective,
  count(ps.id) > 0 AS has_multi_stock
FROM public.products p
LEFT JOIN public.product_stock ps
  ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
GROUP BY p.tenant_id,p.id,p.stock;

COMMENT ON COLUMN public.products.stock IS 'Compatibility cache only. Canonical stock is product_stock; direct updates are rejected.';
COMMENT ON TABLE public.product_stock IS 'Canonical stock balance per tenant/product/warehouse.';
COMMENT ON TABLE public.stock_movements IS 'Immutable stock movement ledger; balances live in product_stock.';

-- Recalculate the compatibility cache after backfill.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tenant_id, product_id FROM public.product_stock LOOP
    PERFORM private.refresh_product_stock_cache(r.tenant_id,r.product_id);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Remove user_roles as an authorization source
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE _role::text
    WHEN 'admin' THEN EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id=_user_id AND m.active AND m.role IN ('owner','admin'))
    WHEN 'gerente' THEN EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id=_user_id AND m.active AND m.role='manager')
    WHEN 'vendedor' THEN EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id=_user_id AND m.active AND m.role='sales')
    WHEN 'cliente' THEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=_user_id)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION private.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id=_user_id AND m.active AND m.role IN ('owner','admin'));
$$;

CREATE OR REPLACE FUNCTION private.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id=_user_id AND m.active AND m.role IN ('owner','admin','manager'));
$$;

CREATE OR REPLACE FUNCTION private.is_sales_rep(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id=_user_id AND m.active AND m.role='sales');
$$;

CREATE OR REPLACE FUNCTION private.is_b2b_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=_user_id
      AND p.customer_group IN ('revendedor','oficina','distribuidor')
      AND p.b2b_status='approved'
  ) OR EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.user_id=_user_id AND m.active AND m.role IN ('owner','admin','manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id,full_name,customer_group,b2b_status)
  VALUES (NEW.id,COALESCE(NEW.raw_user_meta_data->>'full_name',NEW.email),'b2c','none')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON public.user_roles FROM anon, authenticated;
GRANT ALL ON public.user_roles TO service_role;
COMMENT ON TABLE public.user_roles IS 'DEPRECATED legacy table. Authorization is tenant_memberships + tenant_user_permissions only.';
DROP POLICY IF EXISTS "roles_staff_read" ON public.user_roles;
DROP POLICY IF EXISTS "roles_staff_write" ON public.user_roles;

-- -----------------------------------------------------------------------------
-- Tenant-aware RLS replacing legacy user_roles policies
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenant_integration_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_entity_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT,INSERT,UPDATE,DELETE ON public.tenant_integration_states TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.external_entity_mappings TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.integration_events TO authenticated;
GRANT ALL ON public.tenant_integration_states, public.external_entity_mappings, public.integration_events TO service_role;

DROP POLICY IF EXISTS "Admins manage integrations" ON public.integrations;
DROP POLICY IF EXISTS "Tenant members read integration definitions" ON public.integrations;
CREATE POLICY "Tenant members read integration definitions" ON public.integrations
FOR SELECT TO authenticated
USING (private.has_any_active_tenant_membership());

DROP POLICY IF EXISTS "Tenant integration state read" ON public.tenant_integration_states;
DROP POLICY IF EXISTS "Tenant integration state manage" ON public.tenant_integration_states;
CREATE POLICY "Tenant integration state read" ON public.tenant_integration_states
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager','stock']::text[]));
CREATE POLICY "Tenant integration state manage" ON public.tenant_integration_states
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "Admins manage integration_settings" ON public.integration_settings;
DROP POLICY IF EXISTS "Tenant integration settings manage" ON public.integration_settings;
CREATE POLICY "Tenant integration settings manage" ON public.integration_settings
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "Admins manage integration_logs" ON public.integration_logs;
DROP POLICY IF EXISTS "Tenant integration logs read" ON public.integration_logs;
DROP POLICY IF EXISTS "Tenant integration logs write" ON public.integration_logs;
CREATE POLICY "Tenant integration logs read" ON public.integration_logs
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));
CREATE POLICY "Tenant integration logs write" ON public.integration_logs
FOR INSERT TO authenticated
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "External mappings read" ON public.external_entity_mappings;
DROP POLICY IF EXISTS "External mappings manage" ON public.external_entity_mappings;
CREATE POLICY "External mappings read" ON public.external_entity_mappings
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager','stock','sales']::text[]));
CREATE POLICY "External mappings manage" ON public.external_entity_mappings
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "Integration events read" ON public.integration_events;
DROP POLICY IF EXISTS "Integration events manage" ON public.integration_events;
CREATE POLICY "Integration events read" ON public.integration_events
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));
CREATE POLICY "Integration events manage" ON public.integration_events
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "Bling cfg admin only" ON public.bling_config;
DROP POLICY IF EXISTS "Bling tenant config" ON public.bling_config;
CREATE POLICY "Bling tenant config" ON public.bling_config
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "sync_logs_staff_read" ON public.bling_sync_logs;
DROP POLICY IF EXISTS "Bling tenant logs read" ON public.bling_sync_logs;
CREATE POLICY "Bling tenant logs read" ON public.bling_sync_logs
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "AI cfg admin only" ON public.ai_aes_config;
CREATE POLICY "AI tenant config admin" ON public.ai_aes_config
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "chat_sessions_own" ON public.ai_chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_staff_read" ON public.ai_chat_sessions;
CREATE POLICY "AI sessions own tenant" ON public.ai_chat_sessions
FOR ALL TO authenticated
USING (tenant_id=private.requested_storefront_tenant_id() AND user_id=auth.uid())
WITH CHECK (tenant_id=private.requested_storefront_tenant_id() AND user_id=auth.uid());
CREATE POLICY "AI sessions tenant staff read" ON public.ai_chat_sessions
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "chat_msgs_own" ON public.ai_chat_messages;
DROP POLICY IF EXISTS "chat_msgs_staff_read" ON public.ai_chat_messages;
CREATE POLICY "AI messages own tenant" ON public.ai_chat_messages
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.ai_chat_sessions s WHERE s.id=ai_chat_messages.session_id AND s.user_id=auth.uid() AND s.tenant_id=ai_chat_messages.tenant_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.ai_chat_sessions s WHERE s.id=ai_chat_messages.session_id AND s.user_id=auth.uid() AND s.tenant_id=ai_chat_messages.tenant_id));
CREATE POLICY "AI messages tenant staff read" ON public.ai_chat_messages
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "kb_public_read" ON public.ai_knowledge_base;
DROP POLICY IF EXISTS "kb_staff_all" ON public.ai_knowledge_base;
CREATE POLICY "AI knowledge public tenant read" ON public.ai_knowledge_base
FOR SELECT TO anon,authenticated
USING (active AND tenant_id=private.requested_storefront_tenant_id());
CREATE POLICY "AI knowledge tenant staff" ON public.ai_knowledge_base
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "embeddings_staff_read" ON public.ai_product_embeddings;
CREATE POLICY "AI embeddings tenant staff read" ON public.ai_product_embeddings
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager','stock']::text[]));

DROP POLICY IF EXISTS "ai_tool_logs_own_read" ON public.ai_tool_logs;
DROP POLICY IF EXISTS "ai_tool_logs_staff_read" ON public.ai_tool_logs;
CREATE POLICY "AI tool logs own tenant read" ON public.ai_tool_logs
FOR SELECT TO authenticated
USING (user_id=auth.uid() AND tenant_id=private.requested_storefront_tenant_id());
CREATE POLICY "AI tool logs tenant staff read" ON public.ai_tool_logs
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "b2b_self_insert" ON public.b2b_registrations;
DROP POLICY IF EXISTS "b2b_self_read" ON public.b2b_registrations;
DROP POLICY IF EXISTS "b2b_self_update_pending" ON public.b2b_registrations;
DROP POLICY IF EXISTS "b2b_staff_all" ON public.b2b_registrations;
CREATE POLICY "B2B self insert tenant" ON public.b2b_registrations
FOR INSERT TO authenticated
WITH CHECK (user_id=auth.uid() AND tenant_id=private.requested_storefront_tenant_id());
CREATE POLICY "B2B self read tenant" ON public.b2b_registrations
FOR SELECT TO authenticated
USING (user_id=auth.uid() AND tenant_id=private.requested_storefront_tenant_id());
CREATE POLICY "B2B self update pending tenant" ON public.b2b_registrations
FOR UPDATE TO authenticated
USING (user_id=auth.uid() AND tenant_id=private.requested_storefront_tenant_id() AND status='pendente'::public.b2b_status)
WITH CHECK (user_id=auth.uid() AND tenant_id=private.requested_storefront_tenant_id() AND status='pendente'::public.b2b_status AND admin_notes IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL);
CREATE POLICY "B2B tenant staff" ON public.b2b_registrations
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "banners_public_read" ON public.banners;
DROP POLICY IF EXISTS "banners_staff_all" ON public.banners;
CREATE POLICY "Banners public tenant read" ON public.banners
FOR SELECT TO anon,authenticated
USING (tenant_id=private.requested_storefront_tenant_id() AND active AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>=now()));
CREATE POLICY "Banners tenant staff" ON public.banners
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "Users insert own coupon usages" ON public.coupon_usages;
DROP POLICY IF EXISTS "Users see own coupon usages" ON public.coupon_usages;
CREATE POLICY "Coupon usages own tenant insert" ON public.coupon_usages
FOR INSERT TO authenticated
WITH CHECK (user_id=auth.uid() AND tenant_id=private.requested_storefront_tenant_id());
CREATE POLICY "Coupon usages own or tenant staff read" ON public.coupon_usages
FOR SELECT TO authenticated
USING ((user_id=auth.uid() AND tenant_id=private.requested_storefront_tenant_id()) OR private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "Coupons managed by staff" ON public.coupons;
DROP POLICY IF EXISTS "Coupons readable by staff" ON public.coupons;
CREATE POLICY "Coupons tenant staff" ON public.coupons
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "Promotions managed by staff" ON public.promotions;
DROP POLICY IF EXISTS "Promotions readable by all" ON public.promotions;
CREATE POLICY "Promotions public tenant read" ON public.promotions
FOR SELECT TO public
USING (tenant_id=private.requested_storefront_tenant_id());
CREATE POLICY "Promotions tenant staff" ON public.promotions
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "search_aliases_public_read" ON public.search_aliases;
DROP POLICY IF EXISTS "search_aliases_staff_read" ON public.search_aliases;
DROP POLICY IF EXISTS "search_aliases_staff_write" ON public.search_aliases;
CREATE POLICY "Search aliases public tenant read" ON public.search_aliases
FOR SELECT TO public
USING (is_active=true AND tenant_id=private.requested_storefront_tenant_id());
CREATE POLICY "Search aliases tenant staff" ON public.search_aliases
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "snrl_public_insert_validated" ON public.search_no_result_logs;
DROP POLICY IF EXISTS "snrl_staff_delete" ON public.search_no_result_logs;
DROP POLICY IF EXISTS "snrl_staff_read" ON public.search_no_result_logs;
CREATE POLICY "Search no-result public tenant insert" ON public.search_no_result_logs
FOR INSERT TO public
WITH CHECK (tenant_id=private.requested_storefront_tenant_id() AND char_length(term) BETWEEN 1 AND 200 AND char_length(normalized_term) BETWEEN 1 AND 200 AND origin=ANY(ARRAY['site','mcp','ia','admin']::text[]));
CREATE POLICY "Search no-result tenant staff read" ON public.search_no_result_logs
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager','sales']::text[]));
CREATE POLICY "Search no-result tenant managers delete" ON public.search_no_result_logs
FOR DELETE TO authenticated
USING (private.has_tenant_role(tenant_id,ARRAY['owner','admin','manager']::text[]));

DROP POLICY IF EXISTS "product_stock_staff_read" ON public.product_stock;

-- OAuth state store is private to service_role; tenant_id is now part of its isolation key.
REVOKE ALL ON public.oauth_authorization_states FROM anon, authenticated;
GRANT ALL ON public.oauth_authorization_states TO service_role;

-- Final invariant: no legacy source-of-truth switch can be enabled.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bling_config WHERE source_products OR source_stock OR source_price_b2c) THEN
    RAISE EXCEPTION 'Bling source-of-truth flag remained enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles) THEN
    RAISE EXCEPTION 'user_roles must be empty before Phase 1 cutover';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
