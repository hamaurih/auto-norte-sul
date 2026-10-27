-- Resolve PL/pgSQL output-column ambiguity in Bling queue claim.
-- The RETURNS TABLE column "attempts" becomes a PL/pgSQL variable, so every
-- table-column reference in DML predicates must be explicitly qualified.

create or replace function public.claim_bling_order_sync_jobs(p_limit integer default 5)
returns table(job_id uuid, tenant_id uuid, order_id uuid, event_type text, attempts integer)
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.bling_order_sync_jobs as stale_failed
  set status='failed',
      finished_at=now(),
      updated_at=now(),
      last_error='Limite de tentativas excedido'
  where stale_failed.status='processing'
    and stale_failed.started_at < now()-interval '10 minutes'
    and stale_failed.attempts>=5;

  update public.bling_order_sync_jobs as stale_retry
  set status='queued',
      started_at=null,
      scheduled_at=now()+interval '2 minutes',
      updated_at=now(),
      last_error='Worker expirou; reagendado'
  where stale_retry.status='processing'
    and stale_retry.started_at < now()-interval '10 minutes'
    and stale_retry.attempts<5;

  return query
  with picked as (
    select q.id
    from public.bling_order_sync_jobs as q
    where q.status='queued'
      and q.scheduled_at<=now()
      and q.attempts<5
    order by q.scheduled_at,q.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),10))
  ),
  claimed as (
    update public.bling_order_sync_jobs as q
    set status='processing',
        started_at=now(),
        finished_at=null,
        attempts=q.attempts+1,
        last_error=null,
        updated_at=now()
    from picked p
    where q.id=p.id
    returning q.id,q.tenant_id,q.order_id,q.event_type,q.attempts
  )
  select c.id,c.tenant_id,c.order_id,c.event_type,c.attempts
  from claimed c;
end;
$$;

revoke all on function public.claim_bling_order_sync_jobs(integer)
from public,anon,authenticated;
grant execute on function public.claim_bling_order_sync_jobs(integer)
to service_role;
