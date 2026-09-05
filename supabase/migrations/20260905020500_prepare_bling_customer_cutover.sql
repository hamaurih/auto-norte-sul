alter table public.customers add column if not exists bling_id bigint;
alter table public.customers add column if not exists source text not null default 'erp';
alter table public.customers add column if not exists trade_name text;
alter table public.customers add column if not exists city text;
alter table public.customers add column if not exists state text;
alter table public.customers add column if not exists zip_code text;
alter table public.customers add column if not exists imported_at timestamptz;
alter table public.customers add column if not exists source_payload jsonb not null default '{}'::jsonb;

create unique index if not exists customers_tenant_bling_id_uq
  on public.customers(tenant_id, bling_id)
  where bling_id is not null;
create index if not exists customers_tenant_document_idx on public.customers(tenant_id, document);
create index if not exists customers_tenant_name_idx on public.customers(tenant_id, lower(name));
