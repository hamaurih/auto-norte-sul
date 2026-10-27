-- Materialize any sent assisted sale that still lacks a canonical order.
-- The trigger already fires only for relevant column updates, so comparing
-- updated_at values is unnecessary and can be neutralized by timestamp triggers.

create or replace function private.on_sales_order_materialize_core()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='enviado' and new.order_id is null then
    perform private.ensure_assisted_sale_core_order(new.id);
  end if;
  return new;
end;
$$;

revoke all on function private.on_sales_order_materialize_core()
from public,anon,authenticated;
