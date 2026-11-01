-- Fase 2: tenant-safe read-only exception queue; NEVER writes financial status.
BEGIN READ ONLY;
WITH matches AS (
 SELECT tenant_id,transaction_id,count(*) AS match_count,
        sum(matched_amount) AS matched_total
 FROM public.financial_reconciliation_matches
 GROUP BY tenant_id,transaction_id
), classified AS (
 SELECT t.tenant_id,t.id AS transaction_id,t.account_id,t.transaction_date,
        t.direction,t.amount,t.source_type,t.source_id,t.external_reference,
        t.reconciliation_status,coalesce(m.match_count,0) AS match_count,
        coalesce(m.matched_total,0) AS matched_total,
        CASE WHEN t.reconciliation_status='matched' AND m.transaction_id IS NULL
             THEN 'LEGACY_MATCH_WITHOUT_EVIDENCE'
             WHEN t.reconciliation_status='pending' AND m.transaction_id IS NOT NULL
             THEN 'PENDING_WITH_MATCH'
             WHEN m.matched_total>t.amount+0.01
             THEN 'MATCH_EXCEEDS_TRANSACTION'
             WHEN t.reconciliation_status='pending'
             THEN 'PENDING_REVIEW'
             ELSE 'NO_EXCEPTION'
        END AS review_reason
 FROM public.financial_transactions t
 LEFT JOIN matches m ON m.tenant_id=t.tenant_id AND m.transaction_id=t.id
)
SELECT tenant_id,account_id,review_reason,direction,count(*) AS movements,
       sum(amount) AS gross_value,
       min(transaction_date) AS first_date,max(transaction_date) AS last_date
FROM classified
GROUP BY 1,2,3,4 ORDER BY 1,2,3,4;
ROLLBACK;
