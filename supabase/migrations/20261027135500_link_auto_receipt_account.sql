-- Persist the account that received an automatic operational receipt.
create or replace function private.post_operational_cash_movement(
  p_tenant_id uuid,
  p_order_id uuid,
  p_receivable_id uuid,
  p_account_system_code text,
  p_direction text,
  p_amount numeric,
  p_transaction_date date,
  p_payment_method text,
  p_source_type text,
  p_source_id uuid,
  p_external_reference text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_account_id uuid;
  v_channel_id uuid;
  v_tx_id uuid;
begin
  if p_direction not in ('in','out') then raise exception 'Direção financeira inválida'; end if;
  v_account_id := private.financial_account_by_system_code(p_tenant_id,p_account_system_code);

  select o.sales_channel_id into v_channel_id
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;

  select t.id into v_tx_id
  from public.financial_transactions t
  where t.tenant_id=p_tenant_id
    and t.source_type=p_source_type
    and t.external_reference=p_external_reference
  limit 1
  for update;

  if v_tx_id is null then
    insert into public.financial_transactions(
      tenant_id,account_id,transaction_date,direction,amount,description,
      category,source_type,source_id,reconciliation_status,external_reference,
      order_id,sales_channel_id,payment_method,created_by
    )
    values(
      p_tenant_id,v_account_id,p_transaction_date,p_direction,p_amount,p_description,
      case when p_direction='in' then 'venda' else 'estorno' end,
      p_source_type,p_source_id,'matched',p_external_reference,
      p_order_id,v_channel_id,p_payment_method,null
    )
    returning id into v_tx_id;
  end if;

  insert into public.financial_reconciliation_matches(
    tenant_id,transaction_id,target_type,target_id,matched_amount,
    match_method,confidence,matched_by,notes
  )
  values(
    p_tenant_id,v_tx_id,'receivable',p_receivable_id,p_amount,
    case when p_direction='in' then 'provider_confirmation' else 'provider_refund' end,
    1,null,'Vínculo automático Order Core'
  )
  on conflict (transaction_id,target_type,target_id) do nothing;

  update public.financial_transactions
  set reconciliation_status='matched'
  where id=v_tx_id;

  if p_direction='in' then
    update public.financial_receivables
    set receipt_account_id=v_account_id,
        last_received_at=coalesce(last_received_at,p_transaction_date::timestamptz),
        updated_at=now()
    where id=p_receivable_id
      and tenant_id=p_tenant_id;
  end if;

  return v_tx_id;
end;
$$;

revoke all on function private.post_operational_cash_movement(uuid,uuid,uuid,text,text,numeric,date,text,text,uuid,text,text)
from public,anon,authenticated;

-- Audit note: automatic receipts persist the clearing/cash account on the title.
