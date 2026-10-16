# Registro de Decisões

Status: canônico
Atualização: 2026-10-16

Use este arquivo para decisões que alterem arquitetura, regra de negócio, integração, segurança ou operação. Decisões relevantes não devem ficar apenas em conversa, prompt ou memória de agente.

## DEC-001 — Supabase como backend principal

**Status:** vigente

Banco PostgreSQL, autenticação, storage e funções server-side permanecem centralizados no Supabase, salvo decisão posterior registrada aqui.

## DEC-002 — GitHub como fonte de verdade do código

**Status:** vigente

Mudanças de produção devem ser rastreáveis por commit/PR. A branch `main` é protegida e não deve receber mudanças que ignorem os checks obrigatórios.

## DEC-003 — Documentação canônica em `/docs`

**Status:** vigente

A partir desta implantação, PRD, fluxos, TRD, modelo de dados, UI/UX, plano de implementação e testes de aceite em `/docs` constituem a referência funcional/técnica do projeto.

Quando houver conflito entre um prompt antigo e os documentos canônicos, prevalece o documento canônico mais recente aprovado no repositório.

## DEC-004 — Regras críticas no backend

**Status:** vigente

Preço, desconto, autorização, tenant, estoque, pagamento e transições críticas não podem depender exclusivamente de validação no frontend.

## DEC-005 — Migrations versionadas

**Status:** vigente

Mudança de schema deve ser versionada e revisável. Alteração manual em produção sem migration equivalente é dívida crítica e precisa ser reconciliada.

## DEC-006 — CI é gate de produção

**Status:** vigente

Check obrigatório falho bloqueia merge/release. Não considerar CI vermelho como simples aviso.

## Template de nova decisão

```md
## DEC-XXX — Título

**Status:** proposta | vigente | substituída
**Data:** AAAA-MM-DD

### Contexto
Problema ou restrição que originou a decisão.

### Decisão
O que passa a valer.

### Consequências
Impactos, trade-offs, riscos e migrações necessárias.
```
