begin;

create or replace function public.auto_reconcile_bling_order_reference_multiset(p_tenant_id uuid)
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
    select target_type,target_id,sum(matched_amount) allocated
    from public.financial_reconciliation_matches
    where tenant_id=p_tenant_id
    group by target_type,target_id
  ),
  cash as (
    select t.id,t.amount,t.transaction_date,
      substring(coalesce(l.payload->>'Histórico','') from '(?i)pedido de venda[^0-9]*([0-9]+)') order_no
    from public.financial_transactions t
    join public.legacy_import_records l
      on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id and t.source_type='bling_cash_banks'
      and t.direction='in' and t.reconciliation_status='pending'
  ),
  titles as (
    select r.id,r.amount,r.received_at,
      substring(coalesce(l.payload->>'Histórico','') from '(?i)pedido de venda[^0-9]*([0-9]+)') order_no
    from public.financial_receivables r
    join public.legacy_import_records l
      on l.tenant_id=r.tenant_id and l.entity_type='accounts_receivable' and l.migrated_id=r.id
    left join matched_targets m on m.target_type='receivable' and m.target_id=r.id
    where r.tenant_id=p_tenant_id and r.source_type='bling_backup'
      and r.status='received' and r.received_at is not null
      and coalesce(m.allocated,0)<0.009
  ),
  cash_counts as (
    select order_no,amount,count(*) item_count
    from cash where order_no is not null
    group by order_no,amount
  ),
  title_counts as (
    select order_no,amount,count(*) item_count
    from titles where order_no is not null
    group by order_no,amount
  ),
  keys as (
    select order_no,amount from cash_counts
    union
    select order_no,amount from title_counts
  ),
  balanced_orders as (
    select k.order_no
    from keys k
    left join cash_counts c on c.order_no=k.order_no and c.amount=k.amount
    left join title_counts t on t.order_no=k.order_no and t.amount=k.amount
    group by k.order_no
    having bool_and(coalesce(c.item_count,0)=coalesce(t.item_count,0))
       and sum(coalesce(c.item_count,0)) > 1
  ),
  ranked_cash as (
    select c.*,
      row_number() over(partition by c.order_no,c.amount order by c.transaction_date,c.id) item_no
    from cash c join balanced_orders b on b.order_no=c.order_no
  ),
  ranked_titles as (
    select r.*,
      row_number() over(partition by r.order_no,r.amount order by r.received_at,r.id) item_no
    from titles r join balanced_orders b on b.order_no=r.order_no
  ),
  inserted as (
    insert into public.financial_reconciliation_matches
      (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,notes)
    select p_tenant_id,c.id,'receivable',r.id,c.amount,
      'bling_order_reference_multiset',1,
      'Conciliação automática: pedido Bling e multiplicidade exata por valor; grupo fechado sem diferença.'
    from ranked_cash c
    join ranked_titles r
      on r.order_no=c.order_no and r.amount=c.amount and r.item_no=c.item_no
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
    select transaction_id,sum(matched_amount) allocated
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

revoke all on function public.auto_reconcile_bling_order_reference_multiset(uuid) from public, anon;
grant execute on function public.auto_reconcile_bling_order_reference_multiset(uuid) to authenticated, service_role;

commit;