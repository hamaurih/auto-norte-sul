alter table public.orders add column if not exists payment_due_days integer;
do $$ begin
  alter table public.orders add constraint orders_payment_due_days_check
    check (payment_due_days is null or payment_due_days in (0,3,15,30,45,60,90,120));
exception when duplicate_object then null; end $$;
