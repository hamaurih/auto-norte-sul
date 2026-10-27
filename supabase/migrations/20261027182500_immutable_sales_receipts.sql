begin;

create table if not exists public.sales_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  order_id uuid not null,
  receipt_number bigint generated always as identity,
  receipt_code text not null,
  source_channel_id uuid,
  source_pos_sale_id uuid,
  operator_user_id uuid,
  customer_id uuid,
  issued_at timestamptz not null default now(),
  customer_snapshot jsonb not null default '{}'::jsonb,
  sale_snapshot jsonb not null default '{}'::jsonb,
  items_snapshot jsonb not null default '[]'::jsonb,
  payments_snapshot jsonb not null default '[]'::jsonb,
  snapshot_hash text not null,
  created_at timestamptz not null default now(),
  constraint sales_receipts_order_tenant_fkey
    foreign key(order_id,tenant_id) references public.orders(id,tenant_id) on delete restrict,
  constraint sales_receipts_channel_tenant_fkey
    foreign key(source_channel_id,tenant_id) references public.sales_channels(id,tenant_id) on delete restrict,
  constraint sales_receipts_order_unique unique(tenant_id,order_id),
  constraint sales_receipts_code_unique unique(tenant_id,receipt_code),
  constraint sales_receipts_id_tenant_unique unique(id,tenant_id)
);

create index if not exists sales_receipts_tenant_issued_idx
  on public.sales_receipts(tenant_id,issued_at desc);
create index if not exists sales_receipts_pos_sale_idx
  on public.sales_receipts(tenant_id,source_pos_sale_id)
  where source_pos_sale_id is not null;

alter table public.sales_receipts enable row level security;

drop policy if exists sales_receipts_select on public.sales_receipts;
create policy sales_receipts_select
on public.sales_receipts
for select
to authenticated
using ((select private.has_tenant_role(tenant_id,null::text[])));

revoke all on public.sales_receipts from anon;
grant select on public.sales_receipts to authenticated;

create table if not exists public.receipt_fiscal_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null,
  decision text not null check(decision in ('defer','request_invoice')),
  reason text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint receipt_fiscal_decisions_receipt_tenant_fkey
    foreign key(receipt_id,tenant_id) references public.sales_receipts(id,tenant_id) on delete restrict
);

create index if not exists receipt_fiscal_decisions_receipt_idx
  on public.receipt_fiscal_decisions(tenant_id,receipt_id,created_at desc);

alter table public.receipt_fiscal_decisions enable row level security;

drop policy if exists receipt_fiscal_decisions_select on public.receipt_fiscal_decisions;
create policy receipt_fiscal_decisions_select
on public.receipt_fiscal_decisions
for select
to authenticated
using ((select private.has_tenant_role(tenant_id,null::text[])));

revoke all on public.receipt_fiscal_decisions from anon;
grant select on public.receipt_fiscal_decisions to authenticated;

alter table public.fiscal_documents
  add column if not exists receipt_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='fiscal_documents_receipt_tenant_fkey'
      and conrelid='public.fiscal_documents'::regclass
  ) then
    alter table public.fiscal_documents
      add constraint fiscal_documents_receipt_tenant_fkey
      foreign key(receipt_id,tenant_id)
      references public.sales_receipts(id,tenant_id)
      on delete restrict;
  end if;
end
$$;

create index if not exists fiscal_documents_receipt_idx
  on public.fiscal_documents(tenant_id,receipt_id)
  where receipt_id is not null;

create or replace function private.block_sales_receipt_mutation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception 'IMMUTABLE_SALES_RECEIPT';
end
$$;

drop trigger if exists trg_sales_receipts_immutable on public.sales_receipts;
create trigger trg_sales_receipts_immutable
before update or delete on public.sales_receipts
for each row execute function private.block_sales_receipt_mutation();

create or replace function private.capture_sales_receipt_from_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  o public.orders%rowtype;
  v_existing uuid;
  v_items jsonb;
  v_payments jsonb;
  v_customer jsonb;
  v_sale jsonb;
  v_hash text;
  v_receipt_id uuid;
  v_pos_sale_id uuid;
  v_operator uuid;
  v_channel_code text;
begin
  select * into o
  from public.orders
  where id=p_order_id
  for share;

  if not found then return null; end if;
  if o.status::text not in ('pago','faturado','enviado','entregue') then return null; end if;

  select id into v_existing
  from public.sales_receipts
  where tenant_id=o.tenant_id and order_id=o.id;
  if v_existing is not null then return v_existing; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'order_item_id',oi.id,
      'product_id',oi.product_id,
      'sku',oi.sku,
      'name',oi.name,
      'quantity',oi.quantity,
      'list_price',oi.list_price,
      'unit_price',oi.unit_price,
      'price_table',oi.price_table,
      'price_discount_pct',oi.price_discount_pct,
      'discount_amount',oi.discount_amount,
      'line_total',oi.total
    ) order by oi.id),'[]'::jsonb)
  into v_items
  from public.order_items oi
  where oi.tenant_id=o.tenant_id and oi.order_id=o.id;

  if jsonb_array_length(v_items)=0 then return null; end if;

  select ps.id,ps.operator_id
  into v_pos_sale_id,v_operator
  from public.pos_sales ps
  where ps.tenant_id=o.tenant_id and ps.order_id=o.id
  limit 1;

  if v_pos_sale_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'source','pdv',
      'payment_id',pp.id,
      'method',pp.method,
      'amount',pp.amount,
      'installments',pp.installments,
      'provider',pp.provider,
      'provider_reference',pp.provider_reference,
      'status',pp.status
    ) order by pp.created_at,pp.id),'[]'::jsonb)
    into v_payments
    from public.pos_payments pp
    where pp.tenant_id=o.tenant_id
      and pp.sale_id=v_pos_sale_id
      and pp.status='confirmed';
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'source','payment_intent',
      'payment_id',pi.id,
      'method',pi.method,
      'amount',pi.amount,
      'status',pi.status,
      'external_reference',coalesce(pi.external_id,pi.client_reference),
      'paid_at',pi.paid_at
    ) order by pi.created_at,pi.id),'[]'::jsonb)
    into v_payments
    from public.payment_intents pi
    where pi.tenant_id=o.tenant_id
      and pi.order_id=o.id
      and pi.status not in ('failed','cancelled','canceled','expired');
  end if;

  v_operator := coalesce(v_operator,o.user_id);

  select sc.code into v_channel_code
  from public.sales_channels sc
  where sc.id=o.sales_channel_id and sc.tenant_id=o.tenant_id;

  v_customer := jsonb_build_object(
    'customer_id',o.customer_id,
    'name',o.customer_name,
    'email',o.customer_email,
    'phone',o.customer_phone,
    'document',o.customer_document,
    'shipping',jsonb_build_object(
      'zip',o.shipping_zip,
      'street',o.shipping_street,
      'number',o.shipping_number,
      'complement',o.shipping_complement,
      'neighborhood',o.shipping_neighborhood,
      'city',o.shipping_city,
      'state',o.shipping_state
    )
  );

  v_sale := jsonb_build_object(
    'order_id',o.id,
    'order_created_at',o.created_at,
    'status_at_capture',o.status,
    'is_b2b',o.is_b2b,
    'channel_id',o.sales_channel_id,
    'channel_code',v_channel_code,
    'fulfillment_type',o.fulfillment_type,
    'pickup_branch_id',o.pickup_branch_id,
    'subtotal',o.subtotal,
    'shipping',o.shipping,
    'discount',o.discount,
    'total',o.total,
    'payment_method',o.payment_method,
    'notes',o.notes
  );

  v_hash := encode(
    extensions.digest(
      convert_to((v_customer||v_sale||jsonb_build_object('items',v_items,'payments',v_payments))::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.sales_receipts(
    tenant_id,order_id,receipt_code,source_channel_id,source_pos_sale_id,
    operator_user_id,customer_id,issued_at,
    customer_snapshot,sale_snapshot,items_snapshot,payments_snapshot,snapshot_hash
  ) values (
    o.tenant_id,o.id,
    'REC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
    o.sales_channel_id,v_pos_sale_id,
    v_operator,o.customer_id,now(),
    v_customer,v_sale,v_items,v_payments,v_hash
  )
  on conflict (tenant_id,order_id) do nothing
  returning id into v_receipt_id;

  if v_receipt_id is null then
    select id into v_receipt_id from public.sales_receipts
    where tenant_id=o.tenant_id and order_id=o.id;
  end if;

  return v_receipt_id;
end
$$;

revoke all on function private.capture_sales_receipt_from_order(uuid)
from public,anon,authenticated;

create or replace function private.on_order_capture_sales_receipt()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status::text in ('pago','faturado','enviado','entregue')
     and (tg_op='INSERT' or old.status is distinct from new.status) then
    perform private.capture_sales_receipt_from_order(new.id);
  end if;
  return new;
end
$$;

drop trigger if exists trg_order_capture_sales_receipt on public.orders;
create trigger trg_order_capture_sales_receipt
after insert or update of status on public.orders
for each row execute function private.on_order_capture_sales_receipt();

create or replace function private.on_pos_link_capture_sales_receipt()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.order_id is not null and old.order_id is distinct from new.order_id then
    perform private.capture_sales_receipt_from_order(new.order_id);
  end if;
  return new;
end
$$;

drop trigger if exists trg_pos_link_capture_sales_receipt on public.pos_sales;
create trigger trg_pos_link_capture_sales_receipt
after update of order_id on public.pos_sales
for each row execute function private.on_pos_link_capture_sales_receipt();

create or replace function public.set_receipt_fiscal_decision(
  p_receipt_id uuid,
  p_decision text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_receipt public.sales_receipts;
  v_role text;
  v_id uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_decision not in ('defer','request_invoice') then raise exception 'INVALID_FISCAL_DECISION'; end if;

  select * into v_receipt
  from public.sales_receipts
  where id=p_receipt_id;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;

  select tm.role into v_role
  from public.tenant_memberships tm
  where tm.tenant_id=v_receipt.tenant_id
    and tm.user_id=v_user
    and tm.active
  limit 1;

  if v_role not in ('owner','admin','manager','sales') then raise exception 'FORBIDDEN'; end if;

  if p_decision='request_invoice' and exists (
    select 1 from public.fiscal_documents fd
    where fd.tenant_id=v_receipt.tenant_id
      and fd.receipt_id=v_receipt.id
      and fd.status in ('queued','processing','authorized','contingency')
  ) then
    raise exception 'FISCAL_DOCUMENT_ALREADY_ACTIVE';
  end if;

  insert into public.receipt_fiscal_decisions(
    tenant_id,receipt_id,decision,reason,actor_user_id
  ) values (
    v_receipt.tenant_id,v_receipt.id,p_decision,
    nullif(btrim(coalesce(p_reason,'')),''),
    v_user
  ) returning id into v_id;

  return v_id;
end
$$;

revoke all on function public.set_receipt_fiscal_decision(uuid,text,text) from public,anon;
grant execute on function public.set_receipt_fiscal_decision(uuid,text,text) to authenticated,service_role;

-- Existing effective sales receive an immutable receipt snapshot too.
do $$
declare r record;
begin
  for r in
    select o.id
    from public.orders o
    where o.status::text in ('pago','faturado','enviado','entregue')
      and o.deleted_at is null
  loop
    perform private.capture_sales_receipt_from_order(r.id);
  end loop;
end
$$;

commit;