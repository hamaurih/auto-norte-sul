begin;

insert into public.integrations (name, slug, description, category)
values (
  'Stone Conciliação',
  'stone',
  'Conciliação de vendas, recebimentos e Pix Stone por arquivo e webhook.',
  'payment'
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    updated_at = now();

insert into public.tenant_integration_states (tenant_id, integration_id)
select tenant.id, integration.id
from public.tenants tenant
join public.integrations integration on integration.slug = 'stone'
on conflict (tenant_id, integration_id) do nothing;

create table public.stone_conciliation_inbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  notification_type text not null check (notification_type = 'pix'),
  merchant_document text not null check (merchant_document ~ '^[0-9]{11,14}$'),
  reference_date date not null,
  download_url_encrypted text not null,
  payload_sha256 text not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed')),
  attempts integer not null default 0,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, notification_type, merchant_document, reference_date)
);

create index stone_conciliation_inbox_pending_idx
  on public.stone_conciliation_inbox (tenant_id, status, received_at);

create table public.stone_pix_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete restrict,
  inbox_id uuid references public.stone_conciliation_inbox(id) on delete set null,
  stone_event_id text not null,
  reference_date date not null,
  amount numeric(14,2),
  status text,
  payment_method text,
  created_at_stone timestamptz,
  merchant_document text not null,
  pix_type text,
  e2e_id text,
  pix_key text,
  is_pix_sale_key boolean,
  paid_amount numeric(14,2),
  canceled_amount numeric(14,2),
  fee_amount numeric(14,2),
  expires_at timestamptz,
  payer_name text,
  payer_document_type text,
  payer_document text,
  payer_ispb text,
  payer_institution_name text,
  additional_data text,
  terminal_type text,
  terminal_serial_number text,
  operation text,
  provider_datetime timestamptz,
  operation_amount numeric(14,2),
  qrcode_content text,
  description text,
  refund_id text,
  reason text,
  row_fingerprint text not null,
  raw_row jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique (tenant_id, row_fingerprint)
);

create index stone_pix_transactions_reference_idx
  on public.stone_pix_transactions (tenant_id, reference_date desc);
create index stone_pix_transactions_e2e_idx
  on public.stone_pix_transactions (tenant_id, e2e_id)
  where e2e_id is not null;

alter table public.stone_conciliation_inbox enable row level security;
alter table public.stone_pix_transactions enable row level security;

revoke all on table public.stone_conciliation_inbox from public, anon, authenticated;
revoke all on table public.stone_pix_transactions from public, anon;
grant all on table public.stone_conciliation_inbox to service_role;
grant all on table public.stone_pix_transactions to service_role;
grant select on table public.stone_pix_transactions to authenticated;

create policy stone_pix_transactions_tenant_finance_read
on public.stone_pix_transactions for select to authenticated
using (
  private.has_tenant_role(
    tenant_id,
    array['owner', 'admin', 'manager', 'finance']::text[]
  )
);

comment on table public.stone_conciliation_inbox is
  'Server-only inbox for Stone Pix file-ready notifications. Signed download URLs are application-encrypted.';
comment on table public.stone_pix_transactions is
  'Tenant-scoped normalized rows imported from the official Stone Pix reconciliation CSV.';

commit;
