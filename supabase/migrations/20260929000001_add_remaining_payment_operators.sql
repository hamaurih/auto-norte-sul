-- Completa as operadoras já previstas pela interface de integrações.

INSERT INTO public.integrations (name, slug, description, category) VALUES
  ('PagBank', 'pagbank', 'Pagamento: Pix, cartão, boleto e webhooks.', 'payment'),
  ('Pagar.me', 'pagarme', 'Pagamento: cobrança, Pix, cartão e webhooks.', 'payment'),
  ('Asaas', 'asaas', 'Pagamento: cobrança, Pix, boleto e webhooks.', 'payment')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

INSERT INTO public.tenant_integration_states (tenant_id, integration_id)
SELECT tenant.id, integration.id
FROM public.tenants AS tenant
CROSS JOIN public.integrations AS integration
WHERE integration.slug IN ('pagbank', 'pagarme', 'asaas')
ON CONFLICT (tenant_id, integration_id) DO NOTHING;
