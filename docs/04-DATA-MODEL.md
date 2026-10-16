# Modelo de Dados e Back-end

Status: canônico de arquitetura
Atualização: 2026-10-16

Este documento define os domínios que o banco deve representar. Os nomes físicos de tabelas existentes podem diferir; quando diferirem, a implementação deve preservar estas responsabilidades e atualizar este documento.

## 1. Identidade e acesso

Entidades mínimas:
- usuários/perfis;
- papéis e permissões;
- tenants/empresas quando aplicável;
- vínculos usuário ↔ tenant ↔ papel;
- auditoria de ações críticas.

## 2. Catálogo

- produtos;
- SKUs/variações quando aplicável;
- marcas;
- categorias/grupos/subgrupos;
- aplicações/compatibilidades;
- imagens;
- preços por canal/perfil;
- flags de publicação e disponibilidade.

Regra: preço, estoque e visibilidade são conceitos distintos e não devem ser colapsados em um único campo.

## 3. Estoque

- depósitos;
- saldo por produto/SKU e depósito;
- movimentações de estoque;
- reservas;
- transferências;
- ajustes/inventários.

Toda alteração de saldo deve possuir origem rastreável.

## 4. Comercial

- clientes/pessoas/empresas;
- perfis B2B e status de aprovação;
- tabelas/faixas comerciais;
- carrinhos;
- pedidos;
- itens do pedido;
- descontos;
- vendedores e comissão.

## 5. Compras

- fornecedores;
- pedidos de compra;
- itens;
- recebimentos;
- divergências;
- vínculo com entrada de estoque e contas a pagar.

## 6. Financeiro

- contas a pagar;
- contas a receber;
- parcelas;
- pagamentos/recebimentos;
- contas/caixas;
- movimentos financeiros;
- conciliação;
- categorias/centros de custo quando aplicável.

Regra: estorno e cancelamento não apagam histórico; geram reversão ou estado auditável.

## 7. Fiscal

- documentos fiscais;
- itens fiscais;
- status de autorização/cancelamento;
- chaves/protocolos;
- vínculo com venda/compra;
- logs de comunicação com provedor/SEFAZ, sem armazenar segredos.

## 8. Pagamentos e logística

- transações de pagamento;
- eventos/webhooks processados;
- entregas;
- retirada em loja;
- cotações/fretes quando aplicável.

Eventos externos devem ter chave de idempotência ou identificador único do provedor.

## 9. Integrações

- configurações por integração/tenant;
- jobs de sincronização;
- logs de integração;
- mapeamentos de IDs externos;
- dead-letter/falhas pendentes quando necessário.

## 10. Contratos de back-end

Qualquer mutação crítica deve validar no servidor:
- usuário e papel;
- tenant;
- estado atual da entidade;
- valores monetários;
- disponibilidade de estoque quando aplicável;
- idempotência;
- transição de estado permitida.

## 11. Mudanças no schema

Toda mudança estrutural exige:
1. migration versionada;
2. avaliação de compatibilidade/rollback;
3. revisão de RLS/policies;
4. teste de dados existentes;
5. atualização deste documento se a responsabilidade de domínio mudar.