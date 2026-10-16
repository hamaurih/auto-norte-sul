# Plano de Implementação

Status: canônico
Atualização: 2026-10-16

## 1. Princípio de execução

A ordem de implementação deve respeitar dependências de domínio. Não iniciar camada visual de uma feature complexa sem contrato de dados e fluxo minimamente definidos.

## 2. Sequência padrão por feature

1. atualizar PRD/fluxo quando necessário;
2. definir estados e regras;
3. definir contrato técnico e modelo de dados;
4. revisar segurança/RLS;
5. criar migration/back-end;
6. implementar UI;
7. adicionar testes;
8. executar checks locais/CI;
9. homologar com dados de teste;
10. liberar produção por PR aprovado.

## 3. Fases macro

### Fase A — Fundação e segurança
- autenticação;
- papéis/permissões;
- isolamento de tenant;
- migrations reproduzíveis;
- CI/CD e branch protection;
- auditoria de operações críticas.

### Fase B — Catálogo, estoque e comercial
- produtos/categorias/marcas;
- depósitos e movimentações;
- preços por canal/perfil;
- clientes B2C/B2B;
- pedidos e vendas.

### Fase C — E-commerce e checkout
- catálogo público;
- carrinho;
- entrega/retirada;
- pagamento;
- Minhas Compras;
- callbacks idempotentes.

### Fase D — ERP operacional
- compras;
- transferências;
- devoluções/substituições;
- PDV;
- comissão;
- inventário.

### Fase E — Financeiro
- contas a pagar;
- contas a receber;
- fluxo de caixa;
- conciliação;
- DRE/rentabilidade.

### Fase F — Fiscal e integrações avançadas
- NF-e/NFC-e;
- provedores externos;
- retries/observabilidade;
- reconciliação entre sistemas.

### Fase G — SaaS/escala
- configuração por tenant;
- onboarding;
- planos/limites quando aplicável;
- telemetria e operação multiempresa.

## 4. Gates obrigatórios

Não promover uma feature se houver:
- migration falha;
- build/typecheck falho;
- teste crítico falho;
- violação conhecida de RLS/tenant;
- fluxo financeiro/estoque sem reconciliação;
- bug crítico aberto relacionado à entrega.

## 5. Estratégia de branch

- `main`: produção, protegida;
- branches curtas por feature/fix/docs;
- PR obrigatório;
- evitar rebase/force-push de histórico publicado por causa da sincronização com Lovable;
- merge somente após checks verdes.

## 6. Homologação

Features de ERP, pagamento, estoque e fiscal devem ser testadas em ambiente/dados de homologação com cenários positivos e negativos antes de produção.

## 7. Rollback

Toda mudança de risco médio/alto deve definir antes do deploy:
- o que pode falhar;
- como detectar;
- como reverter código;
- como reverter ou compensar dados quando migration não for reversível.