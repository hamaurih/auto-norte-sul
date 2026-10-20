-- Cash-flow cutover: current operations vs read-only Bling legacy history.
-- Runs with service_role only; application checks user membership before invoking.
-- No historical financial data or opening balances are modified.
CREATE OR REPLACE FUNCTION public.financial_cash_summary_cutover(p_tenant_id uuid,p_scope text DEFAULT 'current')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $fn$
DECLARE v_accounts jsonb; v_summary jsonb;
BEGIN
 IF p_scope NOT IN ('current','legacy') THEN RAISE EXCEPTION 'Invalid finance scope'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',a.id,'name',a.name,'type',a.account_type,'institution',a.institution_name,
   'opening_balance',a.opening_balance,
   'balance',CASE WHEN p_scope='current' THEN
     a.opening_balance+coalesce(x.total_in,0)-coalesce(x.total_out,0)
     ELSE coalesce(x.total_in,0)-coalesce(x.total_out,0) END)
   ORDER BY a.name),'[]'::jsonb)
 INTO v_accounts
 FROM public.financial_accounts a
 LEFT JOIN (
   SELECT account_id,
     sum(amount) FILTER(WHERE direction='in') total_in,
     sum(amount) FILTER(WHERE direction='out') total_out
   FROM public.financial_transactions
   WHERE tenant_id=p_tenant_id AND
     (CASE WHEN p_scope='legacy'
       THEN source_type='bling_cash_banks'
       ELSE transaction_date >= DATE '2026-10-21' AND source_type IS DISTINCT FROM 'bling_cash_banks'
     END)
   GROUP BY account_id
 ) x ON x.account_id=a.id
 WHERE a.tenant_id=p_tenant_id AND a.active
 AND (p_scope='legacy' OR a.name <> 'Bling — Caixa/Bancos (histórico)');
 SELECT jsonb_build_object(
   'cash_in',coalesce(sum(amount) FILTER(WHERE direction='in'),0),
   'cash_out',coalesce(sum(amount) FILTER(WHERE direction='out'),0),
   'movement_balance',coalesce(sum(amount) FILTER(WHERE direction='in'),0)-coalesce(sum(amount) FILTER(WHERE direction='out'),0),
   'pending_movements',count(*) FILTER(WHERE reconciliation_status='pending'),
   'partial_movements',count(*) FILTER(WHERE reconciliation_status='partial'),
   'matched_movements',count(*) FILTER(WHERE reconciliation_status='matched')
 ) INTO v_summary
 FROM public.financial_transactions
 WHERE tenant_id=p_tenant_id AND
 (CASE WHEN p_scope='legacy'
   THEN source_type='bling_cash_banks'
   ELSE transaction_date >= DATE '2026-10-21' AND source_type IS DISTINCT FROM 'bling_cash_banks'
 END);
 RETURN jsonb_build_object('accounts',v_accounts,'summary',v_summary);
END;
$fn$;
REVOKE ALL ON FUNCTION public.financial_cash_summary_cutover(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.financial_cash_summary_cutover(uuid,text) TO service_role;
