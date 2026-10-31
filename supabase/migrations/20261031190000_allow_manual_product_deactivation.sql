-- Allow manual deactivation of products with positive stock.
-- Stock <= 0 still forces active=false, but positive stock no longer forces active=true.
-- This preserves an explicit catalog decision made by an authorized user.

create or replace function public.auto_deactivate_out_of_stock()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
    new.active := false;
  elsif coalesce(new.stock, 0) <= 0 then
    new.active := false;
  end if;

  return new;
end;
$$;
