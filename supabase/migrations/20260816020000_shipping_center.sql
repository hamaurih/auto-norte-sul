begin;

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  status text not null default 'aguardando_separacao'
    check (status in ('aguardando_separacao','em_separacao','aguardando_conferencia','pronto_envio','postado','em_transito','entregue','ocorrencia','devolvido','cancelado')),
  carrier_name text,
  service_name text,
  tracking_code text,
  tracking_url text,
  estimated_delivery_at date,
  posted_at timestamptz,
  delivered_at timestamptz,
  picker_user_id uuid references auth.users(id) on delete set null,
  checker_user_id uuid references auth.users(id) on delete set null,
  picked_at timestamptz,
  checked_at timestamptz,
  notes text,
  external_provider text,
  external_shipment_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_order_tenant_fkey foreign key (order_id, tenant_id)
    references public.orders(id, tenant_id) on delete cascade,
  constraint shipments_id_tenant_unique unique (id, tenant_id),
  constraint shipments_order_unique unique (order_id, tenant_id),
  constraint shipments_tracking_url_check check (tracking_url is null or tracking_url ~ '^https://'),
  constraint shipments_notes_length check (notes is null or char_length(notes) <= 1000)
);

create table if not exists public.shipment_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shipment_id uuid not null,
  sequence integer not null default 1 check (sequence > 0),
  weight_kg numeric(10,3) not null check (weight_kg > 0),
  height_cm numeric(10,2) not null check (height_cm > 0),
  width_cm numeric(10,2) not null check (width_cm > 0),
  length_cm numeric(10,2) not null check (length_cm > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipment_packages_shipment_tenant_fkey foreign key (shipment_id, tenant_id)
    references public.shipments(id, tenant_id) on delete cascade,
  constraint shipment_packages_sequence_unique unique (shipment_id, sequence)
);

create table if not exists public.shipment_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shipment_id uuid not null,
  event_type text not null check (event_type in ('criado','separacao','conferencia','status','rastreamento','ocorrencia','atraso','avaria','extravio','devolucao','observacao')),
  from_status text,
  to_status text,
  description text not null check (char_length(description) between 1 and 1000),
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint shipment_events_shipment_tenant_fkey foreign key (shipment_id, tenant_id)
    references public.shipments(id, tenant_id) on delete cascade
);

create index if not exists shipments_queue_idx on public.shipments(tenant_id, status, updated_at desc);
create index if not exists shipments_tracking_idx on public.shipments(tenant_id, tracking_code) where tracking_code is not null;
create index if not exists shipment_packages_shipment_idx on public.shipment_packages(tenant_id, shipment_id, sequence);
create index if not exists shipment_events_timeline_idx on public.shipment_events(tenant_id, shipment_id, created_at desc);

alter table public.shipments enable row level security;
alter table public.shipment_packages enable row level security;
alter table public.shipment_events enable row level security;

revoke all on public.shipments, public.shipment_packages, public.shipment_events from public, anon;
grant select, insert, update on public.shipments, public.shipment_packages to authenticated;
grant select, insert on public.shipment_events to authenticated;
grant all on public.shipments, public.shipment_packages, public.shipment_events to service_role;

drop policy if exists shipments_staff_read on public.shipments;
create policy shipments_staff_read on public.shipments for select to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','sales','stock']::text[]));

drop policy if exists shipments_staff_insert on public.shipments;
create policy shipments_staff_insert on public.shipments for insert to authenticated
with check (
  private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[])
  and created_by = (select auth.uid())
);

drop policy if exists shipments_staff_update on public.shipments;
create policy shipments_staff_update on public.shipments for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]));

drop policy if exists shipment_packages_staff_read on public.shipment_packages;
create policy shipment_packages_staff_read on public.shipment_packages for select to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','sales','stock']::text[]));

drop policy if exists shipment_packages_staff_write on public.shipment_packages;
create policy shipment_packages_staff_write on public.shipment_packages for all to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]));

drop policy if exists shipment_events_staff_read on public.shipment_events;
create policy shipment_events_staff_read on public.shipment_events for select to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','sales','stock']::text[]));

drop policy if exists shipment_events_staff_insert on public.shipment_events;
create policy shipment_events_staff_insert on public.shipment_events for insert to authenticated
with check (
  private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[])
  and actor_user_id = (select auth.uid())
);

create or replace function private.touch_shipment_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_shipment_updated_at() from public, anon, authenticated;

drop trigger if exists shipments_touch_updated_at on public.shipments;
create trigger shipments_touch_updated_at before update on public.shipments
for each row execute function private.touch_shipment_updated_at();

drop trigger if exists shipment_packages_touch_updated_at on public.shipment_packages;
create trigger shipment_packages_touch_updated_at before update on public.shipment_packages
for each row execute function private.touch_shipment_updated_at();

commit;