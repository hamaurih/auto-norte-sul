
DO $$ BEGIN CREATE TYPE public.integration_category AS ENUM ('erp','marketplace','logistics','payment','fiscal','ai','marketing','mobile'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.integration_status AS ENUM ('disconnected','connected','error','configuring'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.integration_log_status AS ENUM ('success','error','warning','pending'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  category public.integration_category NOT NULL,
  status public.integration_status NOT NULL DEFAULT 'disconnected',
  active BOOLEAN NOT NULL DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT ALL ON public.integrations TO service_role;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage integrations" ON public.integrations FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE TRIGGER trg_integrations_updated BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.integration_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_encrypted TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_settings TO authenticated;
GRANT ALL ON public.integration_settings TO service_role;
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage integration_settings" ON public.integration_settings FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE TRIGGER trg_integration_settings_updated BEFORE UPDATE ON public.integration_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.integration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status public.integration_log_status NOT NULL DEFAULT 'pending',
  message TEXT,
  payload JSONB,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_logs TO authenticated;
GRANT ALL ON public.integration_logs TO service_role;
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage integration_logs" ON public.integration_logs FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX idx_integration_logs_integration ON public.integration_logs(integration_id, created_at DESC);

INSERT INTO public.integrations (name, slug, description, category) VALUES
  ('Bling',                    'bling',            'ERP para produtos, estoque, preços e pedidos.',                'erp'),
  ('Mercado Livre',            'mercado-livre',    'Marketplace: publicação, estoque e pedidos.',                  'marketplace'),
  ('Shopee',                   'shopee',           'Marketplace: catálogo, estoque e pedidos.',                    'marketplace'),
  ('Amazon Marketplace',       'amazon',           'Marketplace global: SP-API para produtos e pedidos.',          'marketplace'),
  ('TikTok Shop',              'tiktok-shop',      'Marketplace social TikTok Shop.',                              'marketplace'),
  ('Melhor Envio',             'melhor-envio',     'Cotação e emissão de fretes multi-transportadora.',            'logistics'),
  ('Mercado Pago',             'mercado-pago',     'Gateway de pagamentos: Pix, cartão e boleto.',                 'payment'),
  ('WhatsApp',                 'whatsapp',         'Notificações e atendimento via WhatsApp Business API.',        'marketing'),
  ('Google Merchant Center',   'google-merchant',  'Feed de produtos para Google Shopping.',                       'marketing'),
  ('Meta Pixel / CAPI',        'meta-capi',        'Rastreamento de eventos para Facebook/Instagram Ads.',         'marketing'),
  ('IA A&S Business',          'ia-aes-business',  'Assistente de IA proprietário conectado ao catálogo.',         'ai'),
  ('Fiscal / Nota Fiscal',     'fiscal',           'Emissão fiscal (NFe/NFCe) — estrutura preparada.',             'fiscal'),
  ('Aplicativo Mobile',        'mobile-app',       'App mobile conectado ao ecossistema.',                         'mobile')
ON CONFLICT (slug) DO NOTHING;
