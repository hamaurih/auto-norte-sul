-- Fix Bling queue claim authorization.
-- SECURITY DEFINER changes current_user to the function owner, so the old
-- current_user='service_role' guard made the worker RPC impossible to call.
-- Access is enforced with EXECUTE grants instead.

create or replace function public.claim_bling_order_sync_jobs(p_limit integer default 5)
returns table(job_id uuid, tenant_id uuid, order_id uuid, event_type text, attempts integer)
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.bling_order_sync_jobs
  set status='failed',
      finished_at=now(),
      updated_at=now(),
      last_error='Limite de tentativas excedido'
  where status='processing'
    and started_at < now()-interval '10 minutes'
    and attempts>=5;

  update public.bling_order_sync_jobs
  set status='queued',
      started_at=null,
      scheduled_at=now()+interval '2 minutes',
      updated_at=now(),
      last_error='Worker expirou; reagendado'
  where status='processing'
    and started_at < now()-interval '10 minutes'
    and attempts<5;

  return query
  with picked as (
    select j.id
    from public.bling_order_sync_jobs j
    where j.status='queued'
      and j.scheduled_at<=now()
      and j.attempts<5
    order by j.scheduled_at,j.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),10))
  ),
  claimed as (
    update public.bling_order_sync_jobs j
    set status='processing',
        started_at=now(),
        finished_at=null,
        attempts=j.attempts+1,
        last_error=null,
        updated_at=now()
    from picked p
    where j.id=p.id
    returning j.id,j.tenant_id,j.order_id,j.event_type,j.attempts
  )
  select c.id,c.tenant_id,c.order_id,c.event_type,c.attempts
  from claimed c;
end;
$$;

revoke all on function public.claim_bling_order_sync_jobs(integer)
from public,anon,authenticated;
grant execute on function public.claim_bling_order_sync_jobs(integer)
to service_role;
