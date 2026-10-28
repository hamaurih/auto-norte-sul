begin;

create table if not exists public.fiscal_emission_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null,
  order_id uuid not null,
  provider text not null default 'bling',
  status text not null default 'requested'
    check (status in ('requested','creating','created','submitting','processing','authorized','rejected','failed','cancelled')),
  remote_invoice_id text,
  idempotency_key uuid not null default gen_random_uuid(),
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  submitted_at timestamptz,
  finished_at timestamptz,
  last_error text,
  response_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_emission_commands_receipt_tenant_fkey
    foreign key(receipt_id,tenant_id) references public.sales_receipts(id,tenant_id) on delete restrict,
  constraint fiscal_emission_commands_order_tenant_fkey
    foreign key(order_id,tenant_id) references public.orders(id,tenant_id) on delete restrict,
  constraint fiscal_emission_commands_receipt_unique unique(tenant_id,receipt_id),
  constraint fiscal_emission_commands_idempotency_unique unique(tenant_id,idempotency_key)
);

create index if not exists fiscal_emission_commands_status_idx
  on public.fiscal_emission_commands(tenant_id,status,updated_at desc);

alter table public.fiscal_emission_commands enable row level security;

drop policy if exists fiscal_emission_commands_select on public.fiscal_emission_commands;
create policy fiscal_emission_commands_select
on public.fiscal_emission_commands
for select
to authenticated
using ((select private.has_tenant_role(tenant_id,null::text[])));

revoke all on public.fiscal_emission_commands from anon;
grant select on public.fiscal_emission_commands to authenticated;

create or replace function public.claim_bling_nfe_emission(
  p_receipt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_receipt public.sales_receipts;
  v_role text;
  v_latest_decision text;
  v_command public.fiscal_emission_commands;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_receipt
  from public.sales_receipts
  where id=p_receipt_id
  for share;

  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;

  select tm.role into v_role
  from public.tenant_memberships tm
  where tm.tenant_id=v_receipt.tenant_id
    and tm.user_id=v_user
    and tm.active
  limit 1;

  if v_role not in ('owner','admin','manager','sales') then raise exception 'FORBIDDEN'; end if;

  select d.decision into v_latest_decision
  from public.receipt_fiscal_decisions d
  where d.tenant_id=v_receipt.tenant_id
    and d.receipt_id=v_receipt.id
  order by d.created_at desc,d.id desc
  limit 1;

  if v_latest_decision is distinct from 'request_invoice' then
    raise exception 'FISCAL_EMISSION_NOT_REQUESTED';
  end if;

  if exists (
    select 1 from public.fiscal_documents fd
    where fd.tenant_id=v_receipt.tenant_id
      and fd.receipt_id=v_receipt.id
      and fd.status in ('authorized','processing','contingency')
  ) then
    raise exception 'FISCAL_DOCUMENT_ALREADY_ACTIVE';
  end if;

  insert into public.fiscal_emission_commands(
    tenant_id,receipt_id,order_id,provider,status,requested_by
  )
  values(
    v_receipt.tenant_id,v_receipt.id,v_receipt.order_id,'bling','requested',v_user
  )
  on conflict (tenant_id,receipt_id) do nothing;

  select * into v_command
  from public.fiscal_emission_commands
  where tenant_id=v_receipt.tenant_id
    and receipt_id=v_receipt.id
  for update;

  if v_command.status in ('authorized','processing','submitting','created','creating') then
    return jsonb_build_object(
      'ok',true,
      'reused',true,
      'command_id',v_command.id,
      'status',v_command.status,
      'remote_invoice_id',v_command.remote_invoice_id
    );
  end if;

  update public.fiscal_emission_commands
  set status='creating',
      started_at=coalesce(started_at,now()),
      requested_by=coalesce(requested_by,v_user),
      last_error=null,
      updated_at=now()
  where id=v_command.id
  returning * into v_command;

  return jsonb_build_object(
    'ok',true,
    'reused',false,
    'command_id',v_command.id,
    'status',v_command.status,
    'remote_invoice_id',v_command.remote_invoice_id
  );
end
$$;

revoke all on function public.claim_bling_nfe_emission(uuid) from public,anon;
grant execute on function public.claim_bling_nfe_emission(uuid) to authenticated,service_role;

commit;