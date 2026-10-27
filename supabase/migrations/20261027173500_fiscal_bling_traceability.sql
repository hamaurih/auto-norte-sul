begin;

alter table public.fiscal_documents
  add column if not exists external_payload jsonb not null default '{}'::jsonb,
  add column if not exists document_url text,
  add column if not exists xml_url text,
  add column if not exists last_synced_at timestamptz;

create unique index if not exists fiscal_documents_provider_reference_unique
  on public.fiscal_documents(tenant_id,provider,provider_reference)
  where provider_reference is not null;

create index if not exists fiscal_documents_order_provider_idx
  on public.fiscal_documents(tenant_id,order_id,provider)
  where order_id is not null;

comment on column public.fiscal_documents.external_payload is
  'Snapshot normalizado do provedor fiscal externo; nunca armazena tokens ou segredos.';
comment on column public.fiscal_documents.document_url is
  'URL de visualização/DANFE fornecida pelo provedor, quando disponível.';
comment on column public.fiscal_documents.xml_url is
  'URL de XML/documento fornecida pelo provedor, quando disponível.';
comment on column public.fiscal_documents.last_synced_at is
  'Última sincronização read-only com o provedor fiscal.';

commit;