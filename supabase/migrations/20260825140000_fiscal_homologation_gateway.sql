begin;

alter table public.fiscal_settings
  add column if not exists homologation_status text not null default 'not_configured'
    check (homologation_status in ('not_configured','credentials_missing','ready','testing','approved','failed')),
  add column if not exists homologation_checked_at timestamptz,
  add column if not exists homologation_details jsonb not null default '{}'::jsonb,
  add column if not exists transmission_enabled boolean not null default false;

alter table public.fiscal_documents
  add column if not exists schema_version text not null default '4.00',
  add column if not exists validation_errors jsonb not null default '[]'::jsonb,
  add column if not exists response_xml_path text;

create table if not exists public.fiscal_transmission_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fiscal_document_id uuid not null,
  operation text not null default 'authorize' check(operation in('preflight','authorize','consult','cancel','invalidate')),
  environment text not null default 'homologation' check(environment in('homologation','production')),
  status text not null default 'queued' check(status in('queued','processing','completed','failed','manual_review')),
  attempt integer not null default 0 check(attempt>=0),
  max_attempts integer not null default 3 check(max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  request_hash text,
  response_code text,
  response_message text,
  diagnostics jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_transmission_jobs_document_tenant_fkey
    foreign key(fiscal_document_id,tenant_id)
    references public.fiscal_documents(id,tenant_id) on delete cascade
);

create unique index if not exists fiscal_transmission_jobs_active_unique
  on public.fiscal_transmission_jobs(tenant_id,fiscal_document_id,operation)
  where status in('queued','processing');
create index if not exists fiscal_transmission_jobs_queue_idx
  on public.fiscal_transmission_jobs(status,available_at,created_at);
create index if not exists fiscal_transmission_jobs_tenant_document_idx
  on public.fiscal_transmission_jobs(tenant_id,fiscal_document_id,created_at desc);

alter table public.fiscal_transmission_jobs enable row level security;
drop policy if exists fiscal_transmission_jobs_select on public.fiscal_transmission_jobs;
create policy fiscal_transmission_jobs_select on public.fiscal_transmission_jobs
  for select to authenticated
  using((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));

grant select on public.fiscal_transmission_jobs to authenticated;
grant all on public.fiscal_transmission_jobs to service_role;
revoke all on public.fiscal_transmission_jobs from anon;
revoke insert,update,delete on public.fiscal_transmission_jobs from authenticated;

comment on table public.fiscal_transmission_jobs is 'Fila auditável de operações SEFAZ; somente backend privilegiado pode escrever.';
comment on column public.fiscal_settings.transmission_enabled is 'Barreira operacional: permanece false até homologação e credenciais válidas.';

commit;
