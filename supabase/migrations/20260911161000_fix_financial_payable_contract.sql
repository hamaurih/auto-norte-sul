-- Align the expenses table with the current Accounts Payable workflow.
-- The UI/server uses "open" for an unpaid payable; keep "planned" for
-- compatibility with older generic expense records.

alter table public.expenses
  drop constraint if exists expenses_status_check;

alter table public.expenses
  add constraint expenses_status_check
  check (status in ('planned','open','paid','canceled'));

notify pgrst, 'reload schema';
