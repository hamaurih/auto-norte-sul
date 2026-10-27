-- Phase 2: non-mutating diagnostics. Do not auto-match or update balances.
BEGIN READ ONLY;
SELECT reconciliation_status,direction,count(*) AS movements,
       sum(amount) AS total_amount
FROM public.financial_transactions
GROUP BY reconciliation_status,direction
ORDER BY reconciliation_status,direction;

-- Multiple matches per transaction may be legitimate N:1 / partial settlements.
SELECT m.tenant_id,m.transaction_id,count(*) AS match_rows,
       sum(m.matched_amount) AS matched_total,max(t.amount) AS transaction_amount
FROM public.financial_reconciliation_matches m
JOIN public.financial_transactions t
  ON t.id=m.transaction_id AND t.tenant_id=m.tenant_id
GROUP BY m.tenant_id,m.transaction_id
HAVING count(*)>1 OR sum(m.matched_amount)>max(t.amount)+0.01
ORDER BY count(*) DESC;

-- Status versus match presence. Investigate, do not force status automatically.
SELECT t.reconciliation_status,
       count(*) FILTER (WHERE m.transaction_id IS NULL) AS without_match,
       count(*) FILTER (WHERE m.transaction_id IS NOT NULL) AS with_match
FROM public.financial_transactions t
LEFT JOIN (SELECT DISTINCT tenant_id,transaction_id FROM public.financial_reconciliation_matches) m
 ON m.tenant_id=t.tenant_id AND m.transaction_id=t.id
GROUP BY 1 ORDER BY 1;
ROLLBACK;
