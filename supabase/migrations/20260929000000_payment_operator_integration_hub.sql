-- Operadoras prontas para receber credenciais por tenant.
-- Segredos são gravados exclusivamente pelo servidor em integration_settings.

INSERT INTO public.integrations (name, slug, description, category) VALUES
  ('Cielo', 'cielo', 'Pagamento: Pix, cartão, recorrência e webhooks.', 'payment'),
  ('Rede', 'rede', 'Pagamento: cartão e webhooks de confirmação.', 'payment'),
  ('Getnet', 'getnet', 'Pagamento: Pix, cartão, boleto e webhooks.', 'payment'),
  ('Stripe', 'stripe', 'Pagamento: Pix, cartão, boleto e webhooks.', 'payment')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

INSERT INTO public.tenant_integration_states (tenant_id, integration_id)
SELECT tenant.id, integration.id
FROM public.tenants AS tenant
CROSS JOIN public.integrations AS integration
WHERE integration.slug IN ('cielo', 'rede', 'getnet', 'stripe')
ON CONFLICT (tenant_id, integration_id) DO NOTHING;
