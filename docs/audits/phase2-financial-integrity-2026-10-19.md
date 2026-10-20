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
