begin;

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  account_type text not null check (account_type in ('cash','bank','card','pix','other')),
  institution_name text,
  account_identifier text,
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null references public.financial_accounts(id),
  transaction_date date not null default current_date,
  direction text not null check (direction in ('in','out')),
  amount numeric(14,2) not null check (amount > 0),
  description text not null,
  category text,
  cost_center_id uuid references public.cost_centers(id),
  source_type text,
  source_id uuid,
  reconciliation_status text not null default 'pending' check (reconciliation_status in ('pending','matched','ignored')),
  external_reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.financial_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  matched_at timestamptz not null default now(),
  matched_by uuid references auth.users(id),
  notes text
);

alter table public.financial_receivables add column if not exists cost_center_id uuid references public.cost_centers(id);
alter table public.financial_receivables add column if not exists installment_number integer;
alter table public.financial_receivables add column if not exists installment_total integer;
alter table public.financial_receivables add column if not exists received_amount numeric(14,2) not null default 0;
alter table public.financial_receivables add column if not exists updated_at timestamptz not null default now();

create index if not exists financial_accounts_tenant_idx on public.financial_accounts(tenant_id);
create index if not exists financial_transactions_tenant_date_idx on public.financial_transactions(tenant_id, transaction_date desc);
create index if not exists financial_transactions_reconciliation_idx on public.financial_transactions(tenant_id, reconciliation_status);
create index if not exists financial_receivables_tenant_due_idx on public.financial_receivables(tenant_id, due_date, status);

alter table public.financial_accounts enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.financial_reconciliation_matches enable row level security;

drop policy if exists financial_accounts_staff on public.financial_accounts;
create policy financial_accounts_staff on public.financial_accounts for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','finance']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','finance']));

drop policy if exists financial_transactions_staff on public.financial_transactions;
create policy financial_transactions_staff on public.financial_transactions for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','finance']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','finance']));

drop policy if exists financial_reconciliation_staff on public.financial_reconciliation_matches;
create policy financial_reconciliation_staff on public.financial_reconciliation_matches for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','finance']))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','finance']));

grant select, insert, update on public.financial_accounts, public.financial_transactions, public.financial_reconciliation_matches to authenticated;

commit;