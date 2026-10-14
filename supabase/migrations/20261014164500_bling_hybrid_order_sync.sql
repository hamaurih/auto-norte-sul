alter table public.orders
  add column if not exists bling_sync_status text not null default 'not_synced',
  add column if not exists bling_sync_error text,
  add column if not exists bling_last_sync_at timestamptz,
  add column if not exists bling_stock_launched_at timestamptz,
  add column if not exists bling_accounts_launched_at timestamptz,
  add column if not exists bling_invoice_id text,
  add column if not exists bling_invoice_status text,
  add column if not exists bling_invoice_generated_at timestamptz,
  add column if not exists bling_invoice_authorized_at timestamptz;

do $$ begin
  alter table public.orders add constraint orders_bling_sync_status_check
    check (bling_sync_status in ('not_synced','queued','processing','synced','fiscal_pending','fiscal_submitted','cancelled','error'));
exception when duplicate_object then null; end $$;

create table if not exists public.bling_order_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in ('created','paid','cancelled')),
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_id, event_type)
);

create index if not exists bling_order_sync_jobs_queue_idx
  on public.bling_order_sync_jobs(status, scheduled_at, created_at);
create index if not exists bling_order_sync_jobs_order_idx
  on public.bling_order_sync_jobs(tenant_id, order_id, created_at desc);

alter table public.bling_order_sync_jobs enable row level security;
revoke all on public.bling_order_sync_jobs from anon, authenticated;

create or replace function private.enqueue_bling_order_sync()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_event text;
begin
  if new.user_id is null or new.idempotency_key is null or new.deleted_at is not null then return new; end if;
  if tg_op='INSERT' then v_event:='created';
  elsif old.status is distinct from new.status then
    if new.status::text='pago' then v_event:='paid';
    elsif new.status::text='cancelado' then v_event:='cancelled';
    else return new; end if;
  else return new; end if;

  insert into public.bling_order_sync_jobs(tenant_id,order_id,event_type,status,scheduled_at)
  values(new.tenant_id,new.id,v_event,'queued',now())
  on conflict (tenant_id,order_id,event_type) do update
    set status=case when public.bling_order_sync_jobs.status='done' then 'done' else 'queued' end,
        scheduled_at=case when public.bling_order_sync_jobs.status='done' then public.bling_order_sync_jobs.scheduled_at else now() end,
        last_error=case when public.bling_order_sync_jobs.status='done' then public.bling_order_sync_jobs.last_error else null end,
        updated_at=now();

  if v_event='created' then update public.orders set bling_sync_status='queued',bling_sync_error=null where id=new.id;
  elsif v_event='paid' then update public.orders set bling_sync_status='fiscal_pending',bling_sync_error=null where id=new.id;
  else update public.orders set bling_sync_status='queued',bling_sync_error=null where id=new.id; end if;
  return new;
end;
$$;
revoke all on function private.enqueue_bling_order_sync() from public,anon,authenticated;

drop trigger if exists trg_orders_bling_hybrid_sync on public.orders;
create trigger trg_orders_bling_hybrid_sync after insert or update of status on public.orders
for each row execute function private.enqueue_bling_order_sync();

create or replace function public.claim_bling_order_sync_jobs(p_limit integer default 5)
returns table(job_id uuid, tenant_id uuid, order_id uuid, event_type text, attempts integer)
language plpgsql security definer set search_path=''
as $$
begin
  if current_user <> 'service_role' then raise exception 'service role required'; end if;
  update public.bling_order_sync_jobs set status='failed',finished_at=now(),updated_at=now(),last_error='Limite de tentativas excedido'
    where status='processing' and started_at<now()-interval '10 minutes' and attempts>=5;
  update public.bling_order_sync_jobs set status='queued',started_at=null,scheduled_at=now()+interval '2 minutes',updated_at=now(),last_error='Worker expirou; reagendado'
    where status='processing' and started_at<now()-interval '10 minutes' and attempts<5;
  return query
  with picked as (
    select j.id from public.bling_order_sync_jobs j
    where j.status='queued' and j.scheduled_at<=now() and j.attempts<5
    order by j.scheduled_at,j.created_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),10))
  ), claimed as (
    update public.bling_order_sync_jobs j set status='processing',started_at=now(),finished_at=null,attempts=j.attempts+1,last_error=null,updated_at=now()
    from picked p where j.id=p.id returning j.id,j.tenant_id,j.order_id,j.event_type,j.attempts
  ) select c.id,c.tenant_id,c.order_id,c.event_type,c.attempts from claimed c;
end;
$$;
revoke all on function public.claim_bling_order_sync_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_bling_order_sync_jobs(integer) to service_role;

-- Pedidos históricos pagos sem referência Bling exigem conciliação antes de envio,
-- evitando duplicar venda ou NF já registrada manualmente.