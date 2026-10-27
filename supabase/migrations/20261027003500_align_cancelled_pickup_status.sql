-- Keep pickup workflow consistent with order cancellation.
create or replace function private.align_pickup_status_with_order_status()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.fulfillment_type='pickup' and new.status='cancelado' then
    new.pickup_status := 'cancelled';
  elsif new.fulfillment_type <> 'pickup' then
    new.pickup_status := null;
    new.pickup_ready_at := null;
    new.picked_up_at := null;
    new.pickup_branch_id := null;
  end if;
  return new;
end;
$$;

revoke all on function private.align_pickup_status_with_order_status()
from public,anon,authenticated;

drop trigger if exists trg_00_align_pickup_status on public.orders;
create trigger trg_00_align_pickup_status
before insert or update of status,fulfillment_type
on public.orders
for each row
execute function private.align_pickup_status_with_order_status();

update public.orders
set pickup_status='cancelled',
    updated_at=now()
where fulfillment_type='pickup'
  and status='cancelado'
  and pickup_status is distinct from 'cancelled';
