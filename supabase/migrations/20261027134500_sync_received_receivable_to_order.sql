-- Keep Order Core and Accounts Receivable consistent:
-- a fully received operational receivable confirms the linked order payment.

create or replace function private.sync_order_payment_from_receivable()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_status public.order_status;
  v_actor uuid;
begin
  if new.order_id is null or new.status<>'received' then
    return new;
  end if;

  if tg_op='UPDATE'
     and old.status='received'
     and old.received_amount is not distinct from new.received_amount then
    return new;
  end if;

  select o.status into v_order_status
  from public.orders o
  where o.tenant_id=new.tenant_id and o.id=new.order_id
  for update;

  if not found or v_order_status<>'aguardando_pagamento' then
    return new;
  end if;

  v_actor:=coalesce(new.updated_by,auth.uid());

  perform private.transition_order(
    new.order_id,
    'confirm_payment',
    v_actor
  );

  return new;
end;
$$;

revoke all on function private.sync_order_payment_from_receivable()
from public,anon,authenticated;

drop trigger if exists trg_receivable_sync_order_payment on public.financial_receivables;
create trigger trg_receivable_sync_order_payment
after insert or update of status,received_amount
on public.financial_receivables
for each row
execute function private.sync_order_payment_from_receivable();
