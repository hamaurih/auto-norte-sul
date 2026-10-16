# PRD — Norte Sul Auto

Status: canônico
Owner: produto/negócio
Atualização: 2026-10-16

## 1. Visão

Construir uma plataforma unificada para a Norte Sul Acessórios combinando e-commerce B2C, operação B2B, ERP, PDV e integrações, com arquitetura preparada para automações e agente de IA.

## 2. Objetivos de negócio

- vender online para consumidor final e clientes B2B;
- substituir dependências operacionais hoje dispersas entre ferramentas externas;
- centralizar produtos, estoque, clientes, pedidos, vendas, compras, financeiro e fiscal;
- permitir retirada em loja e entrega;
- dar visibilidade operacional e financeira em tempo real;
- manter trilha de auditoria e regras de acesso por função;
- evoluir sem quebrar produção.

## 3. Perfis principais

- visitante/B2C;
- B2B pendente;
- revendedor;
- oficina;
- distribuidor;
- vendedor;
- gerente;
- administrador.

## 4. Escopo funcional

### E-commerce
Home, catálogo, busca, filtros, página de produto, carrinho, checkout, conta do cliente, histórico de compras, retirada em loja e entrega.

### B2B
Cadastro por CNPJ, aprovação, classificação comercial, tabela de preço por perfil e regras de desconto.

### ERP/PDV
Produtos, estoque, depósitos, transferências, compras, vendas, PDV, devoluções/substituições, clientes, fornecedores, comissões, contas a pagar, contas a receber, fluxo de caixa, conciliação, DRE e fiscal.

### Integrações
Supabase como backend principal; integrações de pagamento, frete/logística, emissão fiscal e sistemas legados quando necessário.

## 5. Regras de negócio prioritárias

- B2B só vê preço especial após aprovação.
- Produto sem estoque não pode ser vendido sem regra explícita de backorder.
- Substituição/devolução deve recompor estoque quando aplicável.
- Descontos B2B respeitam faixa comercial e limite máximo autorizado.
- Comissão deve considerar regra vigente e ser visível apenas a perfis autorizados.
- Depósitos devem ser segregados, incluindo operação de Outlet quando aplicável.
- Publicação no e-commerce deve depender de flag explícita e disponibilidade.
- Operações financeiras e fiscais precisam de idempotência e trilha de auditoria.

## 6. Não funcionais

- segurança por padrão, com RLS e menor privilégio;
- segregação por tenant sempre que o domínio SaaS for aplicado;
- responsivo/mobile-first;
- observabilidade de integrações e jobs;
- migrations versionadas;
- CI obrigatório antes de produção;
- rollback possível;
- performance suficiente para busca e catálogo em uso comercial real.

## 7. Critérios de sucesso

- venda completa B2C e B2B sem intervenção técnica;
- estoque consistente entre PDV, ERP e e-commerce;
- financeiro reconciliável;
- deploy de produção bloqueado quando checks obrigatórios falharem;
- bugs críticos zerados antes de cada go-live de módulo;
- rastreabilidade de quem alterou dados sensíveis.

## 8. Fora de escopo por padrão

Qualquer funcionalidade não descrita neste PRD, nos fluxos canônicos ou em decisão registrada em `08-DECISIONS.md` deve ser tratada como mudança de escopo antes da implementação.