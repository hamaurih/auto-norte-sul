-- Módulo comercial de Orçamentos/Propostas (sem pagamentos).
-- Este projeto usa um Supabase externo: a pasta supabase/migrations/ é gerenciada
-- pela plataforma e não aceita novos arquivos, por isso o script fica em
-- supabase/manual/ e deve ser executado no banco de produção.
-- Idempotente. Preserva isolamento multi-tenant (Phase 0) e as roles
-- owner/admin/manager/sales via private.has_tenant_role.

alter table public.quotes
  add column if not exists document_type text not null default 'orcamento',
  add column if not exists title text,
  add column if not exists version integer not null default 1,
  add column if not exists parent_quote_id uuid,
  add column if not exists payment_terms text,
  add column if not exists delivery_terms text,
  add column if not exists shipping_amount numeric(12,2) not null default 0,
  add column if not exists follow_up_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists lost_reason text,
  add column if not exists converted_sales_order_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_document_type_check') then
    alter table public.quotes add constraint quotes_document_type_check
      check (document_type in ('orcamento','proposta'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_version_positive') then
    alter table public.quotes add constraint quotes_version_positive check (version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_shipping_amount_non_negative') then
    alter table public.quotes add constraint quotes_shipping_amount_non_negative check (shipping_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_parent_quote_id_fkey') then
    alter table public.quotes add constraint quotes_parent_quote_id_fkey
      foreign key (parent_quote_id) references public.quotes(id) on delete set null;
  end if;
end $$;

alter table public.sales_orders
  add column if not exists quote_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_orders_quote_id_fkey') then
    alter table public.sales_orders add constraint sales_orders_quote_id_fkey
      foreign key (quote_id) references public.quotes(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_converted_sales_order_id_fkey') then
    alter table public.quotes add constraint quotes_converted_sales_order_id_fkey
      foreign key (converted_sales_order_id) references public.sales_orders(id) on delete set null;
  end if;
end $$;

create unique index if not exists sales_orders_tenant_quote_unique
  on public.sales_orders (tenant_id, quote_id)
  where quote_id is not null;

create table if not exists public.quote_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_quote_events_tenant_created
  on public.quote_events (tenant_id, created_at desc);
create index if not exists idx_quote_events_quote_created
  on public.quote_events (quote_id, created_at desc);

grant select, insert on public.quote_events to authenticated;
grant all on public.quote_events to service_role;

alter table public.quote_events enable row level security;

drop policy if exists quote_events_tenant_read on public.quote_events;
create policy quote_events_tenant_read on public.quote_events
for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])));

drop policy if exists quote_events_tenant_insert on public.quote_events;
create policy quote_events_tenant_insert on public.quote_events
for insert to authenticated
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','sales'])));

create index if not exists idx_quotes_tenant_status_updated
  on public.quotes (tenant_id, status, updated_at desc)
  where deleted_at is null;
create index if not exists idx_quotes_tenant_follow_up
  on public.quotes (tenant_id, follow_up_at)
  where deleted_at is null and follow_up_at is not null;

comment on column public.quotes.document_type is 'orcamento (interno) ou proposta (enviada ao cliente).';
comment on column public.quotes.version is 'Versão da negociação; revisões criam novo documento com version+1.';
comment on table public.quote_events is 'Timeline comercial auditável de cada orçamento/proposta.';
