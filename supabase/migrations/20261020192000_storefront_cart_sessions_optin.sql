-- Privacy-minimised, first-party, opt-in storefront funnel analytics.
CREATE TABLE IF NOT EXISTS public.storefront_cart_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 items_count integer NOT NULL DEFAULT 0 CHECK(items_count BETWEEN 0 AND 10000),
 estimated_total numeric(14,2) NOT NULL DEFAULT 0 CHECK(estimated_total>=0 AND estimated_total<=100000000),
 last_event text NOT NULL DEFAULT 'cart_updated' CHECK(last_event IN ('cart_updated','checkout_started','order_submitted','cleared')),
 checkout_started_at timestamptz,
 order_submitted_at timestamptz,
 recovered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,session_id)
);
CREATE INDEX IF NOT EXISTS storefront_cart_sessions_tenant_updated_idx
 ON public.storefront_cart_sessions(tenant_id,updated_at DESC);
ALTER TABLE public.storefront_cart_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storefront_cart_sessions FROM anon,authenticated;
COMMENT ON TABLE public.storefront_cart_sessions IS 'Anonymous opt-in cart funnel, no personal identifiers, card data or product line identifiers; retention 90 days.';

GRANT SELECT,INSERT,UPDATE,DELETE ON public.storefront_cart_sessions TO service_role;
