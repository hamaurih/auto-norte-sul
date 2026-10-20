-- Replay-safe counterpart for historical migration 20260904230343.
-- Original remote SQL hard-coded a tenant UUID and failed on empty branches.
-- No production tenant is created. Only seed when tenant exists.
INSERT INTO public.payment_providers
 (tenant_id, code, display_name, adapter_key, environment, supported_methods, capabilities, priority, active)
SELECT t.id, 'mercado_pago', 'Mercado Pago', 'mercado-pago-v1', 'production',
       ARRAY['pix','cartao','boleto']::text[],
       jsonb_build_object('capture',true,'refund',true,'webhook',true,'hosted_checkout',true),
       20, false
FROM public.tenants AS t
WHERE t.slug = 'norte-sul-real' AND t.status = 'active'
ON CONFLICT (tenant_id,code,environment)
DO UPDATE SET display_name=EXCLUDED.display_name,
              adapter_key=EXCLUDED.adapter_key,
              supported_methods=EXCLUDED.supported_methods,
              capabilities=EXCLUDED.capabilities,
              priority=EXCLUDED.priority,
              updated_at=now();
