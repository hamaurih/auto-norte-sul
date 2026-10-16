# Documentação Canônica — Norte Sul Auto

A documentação abaixo é a fonte de verdade para produto e implementação:

1. `01-PRD.md` — problema, objetivos, escopo e regras principais.
2. `02-BUSINESS-FLOWS.md` — fluxos operacionais e exceções.
3. `03-TRD.md` — requisitos técnicos, segurança e arquitetura.
4. `04-DATA-MODEL.md` — domínios de dados e contratos de backend.
5. `05-UI-UX.md` — princípios e comportamento de interface.
6. `06-IMPLEMENTATION-PLAN.md` — ordem de execução, gates e release.
7. `07-ACCEPTANCE-TESTS.md` — critérios de aceite e testes críticos.
8. `08-DECISIONS.md` — registro de decisões arquiteturais e de negócio.

## Regra operacional

Antes de implementar uma feature, qualquer agente ou desenvolvedor deve identificar quais documentos ela afeta. Se o comportamento proposto conflitar com a documentação, primeiro atualize a especificação e registre a decisão necessária; depois implemente.

Prompts antigos, conversas e protótipos não substituem estes documentos.

## Hierarquia em caso de conflito

1. decisão vigente registrada em `08-DECISIONS.md`;
2. PRD e fluxos canônicos;
3. TRD/modelo de dados/testes de aceite;
4. implementação atual;
5. prompts e conversas históricas.

Se a implementação divergir da especificação sem decisão registrada, a divergência deve ser tratada como dívida ou bug, não como nova regra implícita.