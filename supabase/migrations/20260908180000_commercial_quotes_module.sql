-- Evolucao do modulo de orcamentos/propostas. Retrocompativel e multi-tenant.

alter table public.quotes add column if not exists document_type text not null default 'orcamento';
alter table public.quotes add column if not exists title text;
alter table public.quotes add column if not exists version integer not null default 1;
alter table public.quotes add column if not exists parent_quote_id uuid;
alter table public.quotes add column if not exists payment_terms text;
alter table public.quotes add column if not exists delivery_terms text;
alter table public.quotes add column if not exists shipping_amount numeric(12,2) not null default 0;
alter table public.quotes add column if not exists follow_up_at timestamptz;
alter table public.quotes add column if not exists sent_at timestamptz;
alter table public.quotes add column if not exists approved_at timestamptz;
alter table public.quotes add column if not exists closed_at timestamptz;
alter table public.quotes add column if not exists lost_reason text;
alter table public.quotes add column if not exists converted_sales_order_id uuid;

alter table public.sales_orders add column if not exists quote_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.quotes'::regclass and conname='quotes_document_type_check') then
    alter table public.quotes add constraint quotes_document_type_check check (document_type in ('orcamento','proposta'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.quotes'::regclass and conname='quotes_version_positive') then
    alter table public.quotes add constraint quotes_version_positive check (version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.quotes'::regclass and conname='quotes_shipping_amount_nonnegative') then
    alter table public.quotes add constraint quotes_shipping_amount_nonnegative check (shipping_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.quotes'::regclass and conname='quotes_parent_tenant_fkey') then
    alter table public.quotes add constraint quotes_parent_tenant_fkey
      foreign key (parent_quote_id, tenant_id) references public.quotes(id, tenant_id)
      on delete set null (parent_quote_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.quotes'::regclass and conname='quotes_converted_sales_order_tenant_fkey') then
    alter table public.quotes add constraint quotes_converted_sales_order_tenant_fkey
      foreign key (converted_sales_order_id, tenant_id) references public.sales_orders(id, tenant_id)
      on delete set null (converted_sales_order_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.sales_orders'::regclass and conname='sales_orders_quote_tenant_fkey') then
    alter table public.sales_orders add constraint sales_orders_quote_tenant_fkey
      foreign key (quote_id, tenant_id) references public.quotes(id, tenant_id)
      on delete set null (quote_id);
  end if;
end $$;

create unique index if not exists sales_orders_tenant_quote_unique
  on public.sales_orders(tenant_id, quote_id)
  where quote_id is not null;
create index if not exists quotes_tenant_follow_up_idx on public.quotes(tenant_id, follow_up_at) where follow_up_at is not null;
create index if not exists quotes_tenant_status_updated_idx on public.quotes(tenant_id, status, updated_at desc);
create index if not exists quotes_parent_idx on public.quotes(tenant_id, parent_quote_id) where parent_quote_id is not null;

create table if not exists public.quote_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  quote_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint quote_events_tenant_fkey foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint quote_events_quote_tenant_fkey foreign key (quote_id, tenant_id) references public.quotes(id, tenant_id) on delete cascade,
  constraint quote_events_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete set null
);

create index if not exists quote_events_tenant_quote_created_idx on public.quote_events(tenant_id, quote_id, created_at desc);
create index if not exists quote_events_tenant_created_idx on public.quote_events(tenant_id, created_at desc);

alter table public.quote_events enable row level security;

drop policy if exists quote_events_tenant_read on public.quote_events;
create policy quote_events_tenant_read on public.quote_events
for select to authenticated
using ((select private.has_tenant_role(quote_events.tenant_id, array['owner'::text,'admin'::text,'manager'::text,'sales'::text])));

drop policy if exists quote_events_tenant_write on public.quote_events;
create policy quote_events_tenant_write on public.quote_events
for all to authenticated
using ((select private.has_tenant_role(quote_events.tenant_id, array['owner'::text,'admin'::text,'manager'::text,'sales'::text])))
with check ((select private.has_tenant_role(quote_events.tenant_id, array['owner'::text,'admin'::text,'manager'::text,'sales'::text])));

grant select, insert, update, delete on public.quote_events to authenticated;
grant all on public.quote_events to service_role;
