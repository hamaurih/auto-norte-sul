begin;

create or replace function public.auto_reconcile_bling_financials_metadata(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_inserted integer := 0;
  v_matched bigint := 0;
  v_partial bigint := 0;
  v_pending bigint := 0;
begin
  if v_user is not null and not exists (
    select 1
    from public.tenant_memberships m
    where m.user_id=v_user
      and m.tenant_id=p_tenant_id
      and m.active
      and m.role in ('owner','admin')
  ) then
    raise exception 'Somente owner/admin pode executar conciliação histórica automática';
  end if;

  with cash as (
    select
      migrated_id,
      lower(btrim(coalesce(payload->>'Cliente',''))) as party,
      lower(btrim(coalesce(payload->>'Histórico',''))) as history
    from public.legacy_import_records
    where tenant_id=p_tenant_id
      and entity_type='cash_banks'
      and migrated_id is not null
  ),
  receivable_legacy as (
    select
      migrated_id,
      lower(btrim(coalesce(payload->>'Cliente',''))) as party,
      lower(btrim(coalesce(payload->>'Histórico',''))) as history
    from public.legacy_import_records
    where tenant_id=p_tenant_id
      and entity_type='accounts_receivable'
      and migrated_id is not null
  ),
  payable_legacy as (
    select
      migrated_id,
      lower(btrim(coalesce(payload->>'Fornecedor',''))) as party,
      lower(btrim(coalesce(payload->>'Histórico',''))) as history
    from public.legacy_import_records
    where tenant_id=p_tenant_id
      and entity_type='accounts_payable'
      and migrated_id is not null
  ),
  base as (
    select distinct
      t.id as transaction_id,
      'receivable'::text as target_type,
      r.id as target_id,
      t.amount as matched_amount,
      t.external_reference as source_reference,
      c.party as cash_party,
      rl.party as target_party,
      c.history as cash_history,
      rl.history as target_history
    from public.financial_transactions t
    join cash c on c.migrated_id=t.id
    join public.financial_receivables r
      on r.tenant_id=t.tenant_id
     and r.status='received'
     and r.received_at is not null
     and r.received_at::date=t.transaction_date
     and r.received_amount=t.amount
    join receivable_legacy rl on rl.migrated_id=r.id
    where t.tenant_id=p_tenant_id
      and t.source_type='bling_cash_banks'
      and t.direction='in'
      and t.reconciliation_status='pending'

    union all

    select distinct
      t.id as transaction_id,
      'payable'::text as target_type,
      e.id as target_id,
      t.amount as matched_amount,
      t.external_reference as source_reference,
      c.party as cash_party,
      pl.party as target_party,
      c.history as cash_history,
      pl.history as target_history
    from public.financial_transactions t
    join cash c on c.migrated_id=t.id
    join public.expenses e
      on e.tenant_id=t.tenant_id
     and e.status='paid'
     and e.paid_at is not null
     and e.paid_at::date=t.transaction_date
     and e.paid_amount=t.amount
    join payable_legacy pl on pl.migrated_id=e.id
    where t.tenant_id=p_tenant_id
      and t.source_type='bling_cash_banks'
      and t.direction='out'
      and t.reconciliation_status='pending'
  ),
  party_candidates as (
    select
      b.*,
      count(*) over(partition by transaction_id) as transaction_candidates,
      count(*) over(partition by target_type,target_id) as target_candidates
    from base b
    where cash_party<>''
      and cash_party=target_party
  ),
  history_candidates as (
    select
      b.*,
      count(*) over(partition by transaction_id) as transaction_candidates,
      count(*) over(partition by target_type,target_id) as target_candidates
    from base b
    where cash_history<>''
      and cash_history=target_history
  ),
  qualified as (
    select transaction_id,target_type,target_id,matched_amount,source_reference
    from party_candidates
    where transaction_candidates=1 and target_candidates=1
    union
    select transaction_id,target_type,target_id,matched_amount,source_reference
    from history_candidates
    where transaction_candidates=1 and target_candidates=1
  ),
  globally_unique as (
    select
      q.*,
      count(*) over(partition by transaction_id) as tx_pairs,
      count(*) over(partition by target_type,target_id) as target_pairs
    from qualified q
  ),
  inserted as (
    insert into public.financial_reconciliation_matches
      (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,source_reference,notes)
    select
      p_tenant_id,
      transaction_id,
      target_type,
      target_id,
      matched_amount,
      'bling_exact_metadata',
      1,
      source_reference,
      'Conciliação automática: data e valor exatos, mais cliente/fornecedor ou histórico exato; relação 1:1 sem conflito.'
    from globally_unique
    where tx_pairs=1 and target_pairs=1
    on conflict (transaction_id,target_type,target_id) do nothing
    returning transaction_id
  )
  select count(*) into v_inserted from inserted;

  update public.financial_transactions t
  set reconciliation_status=case
    when coalesce(x.allocated,0)>=t.amount-0.009 then 'matched'
    when coalesce(x.allocated,0)>0 then 'partial'
    else 'pending'
  end
  from (
    select transaction_id,sum(matched_amount) as allocated
    from public.financial_reconciliation_matches
    where tenant_id=p_tenant_id
    group by transaction_id
  ) x
  where t.id=x.transaction_id
    and t.tenant_id=p_tenant_id
    and t.source_type='bling_cash_banks';

  select
    count(*) filter(where reconciliation_status='matched'),
    count(*) filter(where reconciliation_status='partial'),
    count(*) filter(where reconciliation_status='pending')
  into v_matched,v_partial,v_pending
  from public.financial_transactions
  where tenant_id=p_tenant_id
    and source_type='bling_cash_banks';

  return jsonb_build_object(
    'ok',true,
    'inserted_matches',v_inserted,
    'matched_movements',v_matched,
    'partial_movements',v_partial,
    'pending_movements',v_pending
  );
end;
$$;

revoke all on function public.auto_reconcile_bling_financials_metadata(uuid) from public,anon;
grant execute on function public.auto_reconcile_bling_financials_metadata(uuid) to authenticated,service_role;

commit;
