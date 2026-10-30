# Go-live comercial — Norte Sul — 20/10/2026
## Arquitetura aprovada
Site/PDV -> pedido imutável/idempotente -> Asaas (Pix, boleto, cartão) -> webhook autenticado -> registro financeiro/estoque -> fila idempotente Bling -> pedido no Bling -> NF-e autorizada no Bling -> chave/protocolo/status refletidos no ERP. Na virada fiscal, alternar por tenant o emissor para o próprio ERP apenas após homologação e bloqueio anti-emissão dupla.

## Evidências verificadas
- Frontend checkout: `src/routes/checkout.tsx`, backend `src/lib/payment.functions.ts`, provedor `src/lib/asaas-payments.server.ts`, webhook `src/routes/api/public/asaas.webhook.ts`.
- Asaas: `payment_providers` production `active=true`, sandbox `active=false`. **Não prova** chave ativa, pagamento real, nem entrega de webhooks.
- Pagamentos registrados: 13 intents (2 expired, 3 created, 6 pending, 2 paid), ainda sem prova de repasse/conciliado.
- Bling: `bling_config` active=true, última situação testada 'sucesso', `expires_at=2026-10-10` — token expirado pode ser renovado se refresh funcionar; requer teste autenticado.
- `sendPendingOrders` enfileira manualmente eventos de pedidos `paid/processing` com idempotência; **nenhum evento `order.export.requested` foi localizado**. Isto não comprova worker funcionando ou pedido fiscal enviado.
- Existe fundação fiscal `src/lib/fiscal.functions.ts`, mas prontidão NF-e própria requer certificado, perfil tributário e homologação SEFAZ.

## Bloqueadores para habilitar operação sem surpresas
1. Verificar integração Asaas em produção (credencial válida e webhook com segredo), cobrança de Pix e geração de boleto com dados de teste controlados; cartão somente com canal seguro, nunca armazenar PAN/CVV no ERP.
2. Provar webhooks autênticos, deduplicação, transições monotônicas e confirmação dos pedidos sem baixa indevida.
3. Criar/verificar worker da fila `integration_events` outbound com retry/backoff, dead-letter e observabilidade; proibir faturamento quando status não autorizado.
4. Testar renovação OAuth Bling e exportação real de pedido sem duplicar; recuperar identificador Bling/nota/status, reconciliar.
5. Verificar reserva/baixa de estoque, frete, retirada, devolução, cancelamento e reembolso.
6. Manter modo fiscal `bling` até emissão própria estar homologada; bloquear emissão paralela.
7. Smoke tests web autenticados e checkout, testar domínio, mensagens de erro, ambiente e usuários reais.
8. Segurança: sem expor segredos, sem cartão em logs, sem cobranças reais de teste inadvertidas.

## Decisão
**NÃO certificado pronto para primeira venda** apenas por provider ativo e rotas existentes. Não modificar saldos ou emitir cobrança real durante auditoria. Primeiro demonstrar fluxo transacional e fiscal íntegro; registrar aceite por etapa.
