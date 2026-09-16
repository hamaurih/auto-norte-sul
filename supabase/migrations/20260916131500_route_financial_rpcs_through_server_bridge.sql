begin;

-- Privileged financial routines are callable only from the server-admin bridge
-- using the service_role. Browser sessions must not reach these RPCs directly.
revoke execute on function public.apply_financial_reconciliation_auto_batch(uuid,uuid,integer) from public, anon, authenticated;
revoke execute on function public.approve_financial_reconciliation_case(uuid,text) from public, anon, authenticated;
revoke execute on function public.auto_reconcile_bling_financials(uuid) from public, anon, authenticated;
revoke execute on function public.auto_reconcile_bling_financials_metadata(uuid) from public, anon, authenticated;
revoke execute on function public.auto_reconcile_bling_order_reference(uuid) from public, anon, authenticated;
revoke execute on function public.auto_reconcile_bling_order_reference_multiset(uuid) from public, anon, authenticated;
revoke execute on function public.discover_financial_reconciliation_adjustments(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.discover_financial_reconciliation_differences(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.discover_financial_reconciliation_many_to_one(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.discover_financial_reconciliation_one_to_many(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.discover_financial_reconciliation_one_to_one(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.discover_financial_reconciliation_transfers(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.financial_cash_summary(uuid) from public, anon, authenticated;
revoke execute on function public.financial_reconciliation_case_details(uuid) from public, anon, authenticated;
revoke execute on function public.financial_reconciliation_queue_summary(uuid) from public, anon, authenticated;
revoke execute on function public.financial_reconciliation_unmatched_queue(uuid,integer,integer) from public, anon, authenticated;
revoke execute on function public.finish_financial_reconciliation_run(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.pay_expense(uuid,numeric,uuid,date,text,text) from public, anon, authenticated;
revoke execute on function public.receive_receivable(uuid,numeric,uuid,date,text,text) from public, anon, authenticated;
revoke execute on function public.reconcile_financial_transaction(uuid,text,uuid,numeric,text) from public, anon, authenticated;
revoke execute on function public.reject_financial_reconciliation_case(uuid,text) from public, anon, authenticated;
revoke execute on function public.reverse_financial_reconciliation_case(uuid,text) from public, anon, authenticated;
revoke execute on function public.run_smart_financial_reconciliation(uuid,boolean) from public, anon, authenticated;
revoke execute on function public.start_financial_reconciliation_run(uuid,text) from public, anon, authenticated;

-- The bridge credential is never available to browser roles.
revoke all on table public.server_admin_bridge_credentials from public, anon, authenticated;
grant select, insert, update, delete on table public.server_admin_bridge_credentials to service_role;

drop policy if exists "server_admin_bridge_service_role_only" on public.server_admin_bridge_credentials;
create policy "server_admin_bridge_service_role_only"
on public.server_admin_bridge_credentials
for all
to service_role
using (true)
with check (true);

commit;