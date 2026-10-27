# Fase 2 — Auditoria financeira inicial (19/10/2026)

## Produção — evidência somente leitura
- 49.525 movimentos financeiros, dos quais 30.807 `matched` e 18.718 `pending`.
- Pendentes: 15.285 entradas e 3.433 saídas.
- 27.161 registros em `financial_reconciliation_matches`.
- 5.746 casos de conciliação, 5 contas financeiras, 0 transferências internas registradas.
- 2 transações possuem mais de um registro de match. Isso não é prova de duplicidade: suportar conciliação 1:N e valores parciais.
- 0 movimentos com valor <= 0 e 0 matches com valor <= 0.

## Gates de avanço
1. Agrupar pendências por conta, origem, referência, idade e valor; verificar importações Bling.
2. Investigar matches excedentes e estados `matched` sem evidência antes de alteração.
3. Validar 1:1, 1:N e N:1, taxas, estorno, transferências e limites de tolerância.
4. Reconstruir saldo teórico por conta incluindo saldo inicial, confrontar com extrato oficial em datas de corte.
5. Aprovar DRE e fluxo gerencial somente após conciliação com documentação.
6. Conservar isolamento tenant, idempotência, trilha de auditoria e rollback.

**Nenhuma baixa, conciliação ou ajuste de saldo automático foi realizado.**

## Achado crítico adicional (verificado por JOIN tenant_id + transaction_id)
- 30.807 transações `matched`: **27.158 com match registrado**, **3.649 sem match na tabela `financial_reconciliation_matches`**.
- 18.718 transações `pending`: nenhuma apresenta registro em `financial_reconciliation_matches`.
- **0** transações com total dos `matched_amount` superior a `financial_transactions.amount + 0,01`.

As 3.649 transações sem vínculo podem derivar de conciliação legada, integração ou inconsistência real. Não classificar como fraude/duplicidade nem alterar `reconciliation_status` sem examinar `source_type`, `source_id`, eventuais relações em outras tabelas, e os fluxos que escrevem esse status. Bloqueia aprovação de saldo e DRE até comprovação.

### Origem das transações sem vínculo
As **3.649** transações `matched` sem registro na tabela de matches são todas do lote/importação `source_type='bling_cash_banks'`; valor nominal somado: **R$ 310.932,58**. O conjunto financeiro inteiro (49.525 movimentos) também tem `source_type='bling_cash_banks'`.

Somatórios brutos de `financial_transactions.amount`:
- `matched`: R$ 8.212.055,37;
- `pending`: R$ 10.258.306,40.

**Esses totais não são saldo ou fluxo líquido**, pois combinam entradas e saídas. É necessário particionar por `direction`, contas e período, e considerar eventual duplicidade de origens.

## Auditoria complementar — 20/10/2026
As 49.525 movimentações concentram-se em uma conta contábil de importação, não em cinco contas bancárias efetivamente reconciliadas; os resultados abaixo são valores nominais e não provam saldos:
- `matched / in`: 28.260, R$ 6.883.226,57.
- `matched / out`: 2.547, R$ 1.328.828,80.
- `pending / in`: 15.285, R$ 2.778.463,85.
- `pending / out`: 3.433, R$ 7.479.842,55.

Casos inteligentes já marcados `auto_applied`: 2.095 `one_to_one` (diferença 0), 1.518 `fee` (diferenças absolutas somadas R$ 3.066,39), 1.213 `interest` (R$ 270.670,98), 918 `other_adjustment` (R$ 37.195,21), 2 `one_to_many` (diferença 0). Total: 5.746.

**Bloqueio de controle:** não reaplicar essas sugestões sem auditoria independente do vínculo original, dos critérios de `confidence`, das evidências em `evidence`, dos lançamentos de ajuste e da idempotência. O valor agregado de diferenças absolutas de juros/ajustes não comprova receita, despesa ou impacto correto na DRE.

**Decisão:** fase financeira ainda não homologada. Fechamento de contas, conciliação de 18.718 pendentes e DRE dependem de extratos oficiais e validação de correspondências; nenhuma mutação financeira autorizada para tratar registros ambíguos automaticamente.
