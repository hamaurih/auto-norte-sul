begin;

create or replace function public.auto_reconcile_bling_order_reference(p_tenant_id uuid)
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
  if v_user is not null and not private.has_tenant_role(
    p_tenant_id,
    array['owner','admin','manager','finance']::text[]
  ) then
    raise exception 'Usuário sem permissão para executar a conciliação';
  end if;

  with matched_targets as (
    select target_type, target_id, sum(matched_amount) as allocated
    from public.financial_reconciliation_matches
    where tenant_id=p_tenant_id
    group by target_type, target_id
  ),
  cash as (
    select t.id,t.amount,
      substring(coalesce(l.payload->>'Histórico','') from '(?i)pedido de venda[^0-9]*([0-9]+)') as order_no
    from public.financial_transactions t
    join public.legacy_import_records l
      on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id and t.source_type='bling_cash_banks'
      and t.direction='in' and t.reconciliation_status='pending'
  ),
  titles as (
    select r.id,r.amount,
      substring(coalesce(l.payload->>'Histórico','') from '(?i)pedido de venda[^0-9]*([0-9]+)') as order_no
    from public.financial_receivables r
    join public.legacy_import_records l
      on l.tenant_id=r.tenant_id and l.entity_type='accounts_receivable' and l.migrated_id=r.id
    left join matched_targets m
      on m.target_type='receivable' and m.target_id=r.id
    where r.tenant_id=p_tenant_id and r.source_type='bling_backup'
      and r.status='received' and r.received_at is not null
      and coalesce(m.allocated,0)<0.009
  ),
  candidates as (
    select c.id as transaction_id,r.id as target_id,c.amount as matched_amount,c.order_no,
      count(*) over(partition by c.id) as tx_candidates,
      count(*) over(partition by r.id) as target_candidates
    from cash c join titles r
      on r.order_no=c.order_no and r.order_no is not null and abs(c.amount-r.amount)<0.009
    where c.order_no is not null
  ),
  inserted as (
    insert into public.financial_reconciliation_matches
      (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,notes)
    select p_tenant_id,transaction_id,'receivable',target_id,matched_amount,
      'bling_order_reference',1,
      'Conciliação automática: número de pedido Bling e valor nominal exatos; relação 1:1 sem conflito.'
    from candidates
    where tx_candidates=1 and target_candidates=1
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
  where tenant_id=p_tenant_id and source_type='bling_cash_banks';

  return jsonb_build_object(
    'ok',true,
    'inserted_matches',v_inserted,
    'matched_movements',v_matched,
    'partial_movements',v_partial,
    'pending_movements',v_pending
  );
end;
$$;

revoke all on function public.auto_reconcile_bling_order_reference(uuid) from public, anon;
grant execute on function public.auto_reconcile_bling_order_reference(uuid) to authenticated, service_role;

commit;