# TRD — Requisitos Técnicos

Status: canônico
Atualização: 2026-10-16

## 1. Arquitetura base

- Frontend web responsivo em TypeScript/React conforme base atual do repositório.
- Supabase para PostgreSQL, autenticação, storage e Edge Functions.
- GitHub como fonte de código e CI.
- Deploy somente a partir de commit rastreável e checks obrigatórios aprovados.
- Integrações externas encapsuladas por serviços/Edge Functions, evitando lógica crítica apenas no cliente.

## 2. Segurança

- RLS habilitada em tabelas com dados de usuário, negócio ou tenant.
- Políticas de menor privilégio.
- Service role nunca exposta ao navegador.
- Funções `SECURITY DEFINER` exigem revisão explícita de `search_path`, permissões e superfície de ataque.
- Dados sensíveis e ações administrativas devem possuir autorização no backend.
- Auditoria para alterações financeiras, fiscais, estoque, preços, permissões e cadastros críticos.

## 3. Integridade de dados

- IDs estáveis e relacionamentos com FKs quando tecnicamente aplicável.
- Operações financeiras, estoque, pedidos e callbacks de pagamento precisam de idempotência.
- Estados de pedido, pagamento, entrega e fiscal devem ser explícitos.
- Nenhum saldo deve depender apenas de cálculo no frontend.
- Migrations são a fonte de verdade para mudanças estruturais de banco.

## 4. Multi-tenant / SaaS

Quando uma entidade for compartilhada entre empresas/tenants:

- cada registro deve ter vínculo inequívoco com tenant;
- consultas e mutações devem ser filtradas/autorizadas no backend/RLS;
- testes automatizados devem provar isolamento entre tenants;
- integrações e configurações devem ser segregadas por tenant.

## 5. Integrações

Cada integração deve possuir:

- credenciais fora do código;
- timeout e tratamento de erro;
- idempotência quando houver escrita;
- logs suficientes para diagnóstico;
- estratégia de retry quando segura;
- identificação da origem do evento;
- mapeamento de estados internos e externos.

## 6. Pagamentos

- confirmação de pagamento baseada em evento confiável do provedor;
- callbacks duplicados não podem duplicar pedido, recebimento ou baixa de estoque;
- estorno/cancelamento deve refletir pedido, financeiro e estoque conforme regra de negócio;
- valores nunca devem ser aceitos apenas do payload do cliente sem validação server-side.

## 7. Estoque

- movimentação é o registro auditável da alteração de saldo;
- depósito de origem/destino deve ser explícito;
- venda, devolução, compra, ajuste e transferência devem ter tipos distintos;
- estoque negativo somente quando regra de negócio explicitamente permitir.

## 8. Observabilidade

Para falhas críticas registrar no mínimo: correlation/request id, operação, entidade, integração, status, timestamp e erro sanitizado. Nunca registrar segredos, tokens ou dados sensíveis desnecessários.

## 9. CI/CD

A `main` deve permanecer protegida. Produção só pode avançar com os checks obrigatórios configurados no repositório aprovados. Mudanças estruturais devem ser feitas em branch + PR.

## 10. Definition of Done técnica

Uma feature só está concluída quando:

- atende PRD e fluxo correspondente;
- typecheck/build passam;
- testes relevantes passam;
- permissões/RLS foram verificadas;
- migration é reproduzível quando houver banco;
- exceções críticas foram tratadas;
- documentação canônica foi atualizada quando o comportamento mudou.