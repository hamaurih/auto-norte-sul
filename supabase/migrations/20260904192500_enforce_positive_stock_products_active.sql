-- Keep storefront/ERP availability aligned with canonical stock.
-- Rule: non-archived products with positive stock are always active;
-- non-archived products with zero/negative stock are inactive.

create or replace function public.auto_deactivate_out_of_stock()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  if new.deleted_at is not null then
    new.active := false;
  elsif coalesce(new.stock, 0) > 0 then
    new.active := true;
  else
    new.active := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_auto_deactivate on public.products;
create trigger trg_products_auto_deactivate
before insert or update of stock, active, deleted_at on public.products
for each row execute function public.auto_deactivate_out_of_stock();

-- Existing data is reconciled separately in production so this migration remains
-- portable and does not hardcode tenant IDs.
