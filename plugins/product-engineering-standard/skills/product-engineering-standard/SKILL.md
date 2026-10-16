---
name: product-engineering-standard
description: Aplique este padrão quando iniciar, revisar, corrigir, expandir ou preparar para produção um app, SaaS, ERP, e-commerce, automação ou integração. Consolida requisitos, fluxos, arquitetura, dados, UX, segurança, integrações, testes, release e operação antes de mudanças relevantes.
---

# Product Engineering Standard

Use esta skill para transformar desenvolvimento por prompts dispersos em engenharia rastreável, verificável e orientada a uma fonte única da verdade.

## Princípio central

Nunca trate conversa, memória do agente ou implementação existente como fonte canônica isolada. A fonte da verdade deve estar versionada no repositório.

Antes de implementar mudança relevante:

1. inspecione o repositório atual;
2. leia `AGENTS.md` e a documentação existente;
3. identifique o comportamento real do código e do banco;
4. compare com a intenção de produto;
5. registre divergências explicitamente;
6. atualize a documentação canônica correspondente;
7. somente então implemente, teste e prepare release.

Não invente regra de negócio para preencher lacunas. Quando a regra não puder ser inferida com segurança a partir do produto, código, dados ou documentação, marque como `DECISION REQUIRED`.

## Pacote canônico obrigatório

O projeto deve manter, preferencialmente em `/docs`, os seguintes artefatos:

1. `01-PRD.md` — problema, usuários, objetivos, escopo, funcionalidades, regras e métricas.
2. `02-BUSINESS-FLOWS.md` — jornadas, estados, exceções, regras operacionais e fluxos críticos.
3. `03-TRD.md` — stack, arquitetura, restrições, performance, observabilidade e requisitos técnicos.
4. `04-DATA-MODEL.md` — entidades, relações, ownership, fonte da verdade, retenção e migrations.
5. `05-UI-UX.md` — navegação, telas, estados, responsividade, acessibilidade e design system.
6. `06-IMPLEMENTATION-PLAN.md` — fases, dependências, ordem de execução, riscos e rollback técnico.
7. `07-ACCEPTANCE-TESTS.md` — critérios de aceite, testes funcionais, regressão, integração e casos negativos.
8. `08-DECISIONS.md` — ADRs/decisões com contexto, decisão, alternativas e consequências.
9. `09-SECURITY.md` — autenticação, autorização, RBAC/RLS, secrets, dados sensíveis, threat model e ambientes.
10. `10-INTEGRATIONS.md` — contratos de API, webhooks, payloads, idempotência, retries, timeout, rate limits e ownership.
11. `11-RELEASE-RUNBOOK.md` — CI/CD, migrations, staging, produção, rollback e validação pós-deploy.
12. `12-OPERATIONAL-CHECKLIST.md` — gates obrigatórios antes de homologação e produção.

Se algum arquivo já existir com outro nome, não duplique sem necessidade. Mapeie o equivalente e registre isso no índice `docs/README.md`.

## Ordem padrão de trabalho

### Fase 0 — Discovery do estado atual

- leia README, AGENTS, package manifests e config de infraestrutura;
- identifique frontend, backend, banco, auth, integrações e deploy;
- identifique workflows CI/CD;
- identifique migrations, policies, funções privilegiadas e secrets esperados;
- identifique documentação existente;
- liste lacunas entre comportamento atual e intenção declarada.

Saída: diagnóstico factual, sem alterar runtime.

### Fase 1 — Produto e regras

Atualize primeiro:

- PRD;
- Business Flows;
- Decisions quando houver escolha nova.

Não avance para implementação se a mudança ainda tiver regra de negócio ambígua capaz de causar perda financeira, inconsistência de estoque, falha fiscal, segurança incorreta ou comportamento irreversível.

### Fase 2 — Arquitetura e contratos

Atualize conforme impacto:

- TRD;
- Data Model;
- Security;
- Integrations.

Documente explicitamente:

- sistema de registro/source of truth;
- fronteiras de responsabilidade;
- eventos e side effects;
- idempotência;
- consistência transacional;
- retries;
- observabilidade;
- estratégia de migrations e rollback.

### Fase 3 — UX e critérios de aceite

Atualize:

- UI/UX;
- Acceptance Tests.

Cada fluxo relevante deve ter estados mínimos quando aplicável:

- loading;
- vazio;
- sucesso;
- erro;
- retry;
- permissão insuficiente;
- dado indisponível;
- operação parcialmente concluída.

### Fase 4 — Plano de implementação

Quebre a mudança em unidades pequenas e verificáveis.

Para cada etapa registre:

- dependências;
- arquivos ou módulos afetados;
- mudança de banco;
- risco;
- teste necessário;
- condição de conclusão;
- rollback quando aplicável.

### Fase 5 — Implementação

Implemente somente após a documentação mínima necessária estar coerente.

Regras:

- não enfraquecer autenticação, autorização, RLS, CI ou validações para “fazer funcionar”;
- não ocultar erro com fallback silencioso que altere regra de negócio;
- não duplicar fonte da verdade;
- não alterar contrato externo sem atualizar `10-INTEGRATIONS.md`;
- não criar migration sem documentar compatibilidade e rollback quando relevante;
- preserve backward compatibility quando exigida.

### Fase 6 — Verificação

Execute os testes e gates disponíveis no projeto.

No mínimo verifique, quando existentes:

- typecheck;
- lint;
- unit tests;
- integration tests;
- build de produção;
- testes de segurança/RLS;
- migrations;
- contratos de integração;
- smoke test dos fluxos alterados.

Não declare concluído se gate obrigatório estiver vermelho.

### Fase 7 — Release

Antes de produção valide `11-RELEASE-RUNBOOK.md` e `12-OPERATIONAL-CHECKLIST.md`.

A release deve responder:

- qual SHA/versão será publicada;
- quais migrations serão executadas;
- qual a ordem;
- como validar sucesso;
- como detectar regressão;
- como reverter;
- quem ou qual sistema é source of truth após a publicação.

## Regras de governança

1. Mudança de comportamento exige atualização do documento canônico correspondente no mesmo PR.
2. Nova decisão arquitetural relevante exige ADR/registro em `08-DECISIONS.md`.
3. Mudança em tabela, policy, RPC ou evento exige revisão de Data Model e Security.
4. Mudança em API/webhook exige revisão de Integrations e Acceptance Tests.
5. Mudança em fluxo do usuário exige revisão de Business Flows, UI/UX e Acceptance Tests.
6. Mudança em deploy/migration exige revisão do Release Runbook.
7. Uma feature só é `DONE` quando código, documentação e critérios de aceite estão coerentes.
8. Produção não deve receber commit com gates obrigatórios falhando.

## Quando aplicar em projeto já existente

Não reescreva o sistema automaticamente.

Faça primeiro uma auditoria de aderência:

- `IMPLEMENTED AND DOCUMENTED`;
- `IMPLEMENTED BUT UNDOCUMENTED`;
- `DOCUMENTED BUT NOT IMPLEMENTED`;
- `CONFLICT`;
- `DECISION REQUIRED`.

Transforme diferenças em backlog priorizado por:

1. segurança e integridade de dados;
2. financeiro/fiscal/estoque;
3. indisponibilidade e perda operacional;
4. contratos de integração;
5. experiência do usuário;
6. dívida técnica.

## Comando de aplicação esperado

Quando o usuário pedir para aplicar esta skill a um repositório, faça a auditoria completa, crie ou consolide os 12 artefatos, atualize `AGENTS.md` para torná-los normativos, gere backlog das divergências e prepare as mudanças em branch/PR. Não modifique runtime apenas para fazê-lo coincidir com o documento sem antes classificar a divergência.

## Critério de conclusão

A aplicação desta skill está concluída somente quando:

- existe um índice claro da documentação;
- os 12 domínios estão cobertos ou mapeados para documentos equivalentes;
- regras críticas possuem fonte canônica;
- divergências entre código e documentação foram classificadas;
- existe plano priorizado de correção;
- AGENTS orienta os agentes a consultar e manter a fonte canônica;
- critérios de aceite e release gates estão definidos;
- nenhuma afirmação de “pronto” depende apenas de o código compilar.
