-- Tenant-specific UAT scenarios; never auto-approve runs or create fake payments.
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-201','E-commerce','Origem por canal','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Comparar as três fontes de vendas; confirmar um pedido checkout e conferir BI do ERP e painel SITE'),'Uma venda feita no site deve ser SITE e não aparecer como PDV ou WhatsApp','critical',1
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-301','E-commerce','Checkout PIX','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Criar pedido homologado Pix; validar QR Code, webhook, status e estoque'),'Pagamento Pix registra intenção, QR Code e confirmação Asaas sem duplicar','critical',2
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-302','E-commerce','Checkout boleto','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Gerar cobrança homologada; conferir linha digitável e vencimento; não simular confirmação'),'Boleto B2C 3 dias e B2B no prazo aprovado sem liberar antes da confirmação','critical',3
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-303','E-commerce','Checkout cartão','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Transação homologada; verificar dados não armazenados e confirmação de webhook'),'Cartão até 6 vezes confirmado apenas por retorno seguro do gateway','critical',4
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-304','E-commerce','Webhook e idempotência','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Reexecutar payload autenticado em homologação e auditar contadores'),'Mesmo evento e pagamento não duplicam baixa, estoque, caixa ou pedido','critical',5
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-305','E-commerce','Exportação Bling e NF-e','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Consultar fila, exportar pedido de teste e auditar NF-e sem segunda emissão'),'Pedido aprovado é exportado uma vez, com identificador, nota e protocolo retornados','critical',6
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-401','E-commerce','Editor de layout','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Salvar rascunho, comparar vitrine, publicar e comparar desktop/mobile'),'Rascunho não altera produção; publicação aplica cores e textos do site apenas','high',7
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-402','E-commerce','Banners e catálogo','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Criar campanha teste e conferir publicação/ordem/visibilidade'),'Vitrine publica banners nos horários corretos e produtos autorizados com estoque','high',8
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-501','E-commerce','Consentimento dos carrinhos','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Testar aceitar, negar, revogar e conferir sessões pelo serviço'),'Não rastrear antes de opt-in; negar ou revogar impede novos eventos','critical',9
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-502','E-commerce','Abandono e reativação','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Simular sessão em homologação, iniciar checkout, abandonar e retomar'),'Sessão consentida inativa por 30 minutos entra em abandono, retomada em reativação','high',10
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-601','E-commerce','BI Site','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Criar vendas controladas nos três canais e conferir total por origem'),'Receita confirmada exclui boleto pendente, cancelados, PDV e WhatsApp','critical',11
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
INSERT INTO public.homologation_test_cases(tenant_id,code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
SELECT t.tenant_id,'SITE-701','E-commerce','Homologação e aceite','Teste de aceite operacional do canal SITE','Executar no ambiente controlado; nunca gerar NF-e em duplicidade',jsonb_build_array('Revisar evidências, gates CI, deploy READY e aceite formal no painel'),'Sem bugs P0; testes aprovados por responsável e versão publicada','critical',12
FROM public.tenant_storefronts t WHERE t.slug = 'norte-sul-demo'
ON CONFLICT (tenant_id,code) DO NOTHING;
