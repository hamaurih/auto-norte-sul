begin;

create table if not exists public.fiscal_certificate_secrets (
  fiscal_setting_id uuid primary key references public.fiscal_settings(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  secret_reference uuid not null unique default gen_random_uuid(),
  pfx_encrypted text not null,
  password_encrypted text not null,
  file_name text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 1048576),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiscal_setting_id, tenant_id)
);

create index if not exists fiscal_certificate_secrets_tenant_idx
  on public.fiscal_certificate_secrets (tenant_id);

alter table public.fiscal_certificate_secrets enable row level security;

revoke all on table public.fiscal_certificate_secrets from public, anon, authenticated;
grant all on table public.fiscal_certificate_secrets to service_role;

comment on table public.fiscal_certificate_secrets is
  'Cofre server-only de certificados fiscais A1. Conteúdo e senha são cifrados pela aplicação antes da persistência.';
comment on column public.fiscal_certificate_secrets.pfx_encrypted is
  'PKCS#12 em base64 protegido por AES-GCM; nunca expor pela Data API.';
comment on column public.fiscal_certificate_secrets.password_encrypted is
  'Senha do PKCS#12 protegida por AES-GCM; nunca expor pela Data API.';

commit;
