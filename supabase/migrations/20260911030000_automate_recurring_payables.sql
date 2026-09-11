alter table public.expenses
  add column if not exists recurrence_parent_id uuid references public.expenses(id) on delete set null;

create unique index if not exists expenses_recurring_next_period_unique
  on public.expenses (tenant_id, recurrence_parent_id, due_date)
  where recurrence_parent_id is not null;

create or replace function private.create_next_recurring_expense()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  next_due_date date;
  next_competence_date date;
  root_id uuid;
begin
  if tg_op <> 'UPDATE'
     or old.status = 'paid'
     or new.status <> 'paid'
     or not new.recurring
     or new.recurrence not in ('weekly', 'monthly', 'yearly') then
    return new;
  end if;

  next_due_date := case new.recurrence
    when 'weekly' then new.due_date + 7
    when 'monthly' then (new.due_date + interval '1 month')::date
    when 'yearly' then (new.due_date + interval '1 year')::date
  end;

  next_competence_date := case new.recurrence
    when 'weekly' then new.competence_date + 7
    when 'monthly' then (new.competence_date + interval '1 month')::date
    when 'yearly' then (new.competence_date + interval '1 year')::date
  end;

  root_id := coalesce(new.recurrence_parent_id, new.id);

  insert into public.expenses (
    tenant_id, category_id, cost_center_id, description, kind, status, amount,
    competence_date, due_date, supplier_name, document_number, notes,
    recurring, recurrence, recurrence_parent_id, created_by, updated_by
  ) values (
    new.tenant_id, new.category_id, new.cost_center_id, new.description, new.kind, 'open', new.amount,
    next_competence_date, next_due_date, new.supplier_name, new.document_number, new.notes,
    true, new.recurrence, root_id, new.updated_by, new.updated_by
  )
  on conflict (tenant_id, recurrence_parent_id, due_date)
  where recurrence_parent_id is not null do nothing;

  return new;
end;
$$;

revoke all on function private.create_next_recurring_expense() from public, anon, authenticated;

drop trigger if exists trg_create_next_recurring_expense on public.expenses;
create trigger trg_create_next_recurring_expense
  after update of status on public.expenses
  for each row execute function private.create_next_recurring_expense();