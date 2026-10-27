-- Align historical cancelled storefront orders with their completed Bling queue jobs.
update public.orders o
set bling_sync_status='cancelled',
    bling_sync_error=null,
    bling_last_sync_at=coalesce(o.bling_last_sync_at,now()),
    updated_at=now()
where o.status='cancelado'
  and o.bling_id is null
  and exists (
    select 1
    from public.bling_order_sync_jobs j
    where j.tenant_id=o.tenant_id
      and j.order_id=o.id
      and j.status='done'
      and j.event_type in ('created','cancelled')
  )
  and o.bling_sync_status is distinct from 'cancelled';
