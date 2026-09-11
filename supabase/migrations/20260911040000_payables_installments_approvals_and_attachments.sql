alter table public.expenses
  add column if not exists installment_group_id uuid,
  add column if not exists installment_number integer,
  add column if not exists installment_total integer,
  add column if not exists approval_status text not null default 'approved',
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists approval_note text;

alter table public.expenses
  drop constraint if exists expenses_approval_status_check;
alter table public.expenses
  add constraint expenses_approval_status_check
  check (approval_status in ('pending','approved','rejected'));

alter table public.expenses
  drop constraint if exists expenses_installments_check;
alter table public.expenses
  add constraint expenses_installments_check
  check (
    (installment_group_id is null and installment_number is null and installment_total is null)
    or (
      installment_group_id is not null
      and installment_number between 1 and installment_total
      and installment_total >= 2
    )
  );

create index if not exists expenses_installment_group_idx
  on public.expenses (tenant_id, installment_group_id, installment_number);

create table if not exists public.financial_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  kind text not null check (kind in ('boleto','xml','comprovante','outro')),
  file_name text not null check (char_length(file_name) between 1 and 180),
  content_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  storage_path text not null unique,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.financial_attachments enable row level security;
revoke all on table public.financial_attachments from anon;
grant select,insert,delete on table public.financial_attachments to authenticated;

drop policy if exists financial_attachments_read on public.financial_attachments;
create policy financial_attachments_read on public.financial_attachments
  for select to authenticated
  using (private.has_tenant_role(tenant_id));

drop policy if exists financial_attachments_write on public.financial_attachments;
create policy financial_attachments_write on public.financial_attachments
  for all to authenticated
  using (private.has_tenant_role(tenant_id, array['owner','admin','manager']))
  with check (private.has_tenant_role(tenant_id, array['owner','admin','manager']));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'financial-documents','financial-documents',false,10485760,
  array['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp']
)
on conflict (id) do update set public=false,file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists financial_documents_read on storage.objects;
create policy financial_documents_read on storage.objects
  for select to authenticated
  using (
    bucket_id='financial-documents'
    and private.has_tenant_role((storage.foldername(name))[1]::uuid)
  );

drop policy if exists financial_documents_insert on storage.objects;
create policy financial_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id='financial-documents'
    and private.has_tenant_role((storage.foldername(name))[1]::uuid, array['owner','admin','manager'])
  );