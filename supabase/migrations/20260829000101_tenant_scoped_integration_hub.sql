-- Tenant-scoped integration hub.
-- Secrets are encrypted by the server before being stored in value_encrypted.

CREATE TABLE IF NOT EXISTS public.tenant_integration_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  status public.integration_status NOT NULL DEFAULT 'disconnected',
  active BOOLEAN NOT NULL DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, integration_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_integration_states TO authenticated;
GRANT ALL ON public.tenant_integration_states TO service_role;

INSERT INTO public.integrations (name, slug, description, category) VALUES
  ('Nuvemshop',          'nuvemshop',          'E-commerce: loja, catálogo, estoque e pedidos.',                 'ecommerce'),
  ('Shopify',            'shopify',            'E-commerce: Admin API para catálogo, estoque e pedidos.',      'ecommerce'),
  ('WooCommerce',        'woocommerce',        'E-commerce: produtos, estoque e pedidos via REST API.',        'ecommerce'),
  ('Tray',               'tray',               'E-commerce brasileiro: catálogo, estoque e pedidos.',          'ecommerce'),
  ('Magalu Marketplace', 'magalu-marketplace',  'Marketplace: anúncios, estoque e pedidos.',                    'marketplace'),
  ('Olist',              'olist',              'Marketplace: catálogo, estoque e pedidos.',                      'marketplace'),
  ('Frenet',             'frenet',             'Logística: cotação de fretes e transportadoras.',               'logistics'),
  ('Kangu',              'kangu',              'Logística: cotação e pontos de entrega.',                       'logistics'),
  ('PagBank',             'pagbank',            'Pagamento: Pix, cartão, boleto e webhooks.',                    'payment'),
  ('Pagar.me',            'pagarme',            'Pagamento: cobrança, Pix, cartão e webhooks.',                  'payment'),
  ('Asaas',               'asaas',              'Pagamento: cobrança, Pix, boleto e webhooks.',                 'payment')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.tenant_integration_states (tenant_id, integration_id)
SELECT t.id, i.id
FROM public.tenants t
CROSS JOIN public.integrations i
ON CONFLICT (tenant_id, integration_id) DO NOTHING;

ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.integration_logs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.integration_settings WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.integration_logs WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'integration_settings/integration_logs possuem linhas antigas sem tenant_id; faça a migração por ambiente antes de aplicar esta versão';
  END IF;
END $$;

ALTER TABLE public.integration_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.integration_logs ALTER COLUMN tenant_id SET NOT NULL;

DO $$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.integration_settings'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%(integration_id, key)%'
  LOOP
    EXECUTE format('ALTER TABLE public.integration_settings DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.integration_settings
  DROP CONSTRAINT IF EXISTS integration_settings_tenant_integration_key_key;

ALTER TABLE public.integration_settings
  ADD CONSTRAINT integration_settings_tenant_integration_key_key
  UNIQUE (tenant_id, integration_id, key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_settings TO authenticated;
GRANT ALL ON public.integration_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_logs TO authenticated;
GRANT ALL ON public.integration_logs TO service_role;

CREATE INDEX IF NOT EXISTS idx_tenant_integration_states_tenant
  ON public.tenant_integration_states(tenant_id, integration_id);
CREATE INDEX IF NOT EXISTS idx_integration_settings_tenant
  ON public.integration_settings(tenant_id, integration_id);
CREATE INDEX IF NOT EXISTS idx_integration_logs_tenant
  ON public.integration_logs(tenant_id, integration_id, created_at DESC);

ALTER TABLE public.tenant_integration_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage integrations" ON public.integrations;
DROP POLICY IF EXISTS "Tenant members read integrations" ON public.integrations;
CREATE POLICY "Tenant members read integrations"
  ON public.integrations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_integration_states state
      WHERE state.integration_id = integrations.id
        AND private.has_tenant_role(
          state.tenant_id,
          ARRAY['owner','admin','manager','stock']::text[]
        )
    )
  );

DROP POLICY IF EXISTS "Tenant integration states read" ON public.tenant_integration_states;
DROP POLICY IF EXISTS "Tenant integration states manage" ON public.tenant_integration_states;
CREATE POLICY "Tenant integration states read"
  ON public.tenant_integration_states FOR SELECT TO authenticated
  USING (
    private.has_tenant_role(
      tenant_id,
      ARRAY['owner','admin','manager','stock']::text[]
    )
  );
CREATE POLICY "Tenant integration states manage"
  ON public.tenant_integration_states FOR ALL TO authenticated
  USING (
    private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[])
  )
  WITH CHECK (
    private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[])
  );

DROP POLICY IF EXISTS "Admins manage integration_settings" ON public.integration_settings;
DROP POLICY IF EXISTS "Tenant admins manage integration_settings" ON public.integration_settings;
CREATE POLICY "Tenant admins manage integration_settings"
  ON public.integration_settings FOR ALL TO authenticated
  USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]))
  WITH CHECK (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "Admins manage integration_logs" ON public.integration_logs;
DROP POLICY IF EXISTS "Tenant admins manage integration_logs" ON public.integration_logs;
CREATE POLICY "Tenant admins manage integration_logs"
  ON public.integration_logs FOR ALL TO authenticated
  USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]))
  WITH CHECK (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]));
