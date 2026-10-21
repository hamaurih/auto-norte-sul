-- Reconciliação idempotente de vendas pagas, sem emissão de documento fiscal.
-- Evita reimportação de pedidos já associados ao Bling.
begin;
insert into public.bling_order_sync_jobs(tenant_id,order_id,event_type,status,scheduled_at)
select o.tenant_id,o.id,'paid','queued',now()
from public.orders o
where o.status::text in ('pago','faturado','enviado','entregue')
  and o.deleted_at is null
  and o.bling_id is null
  and exists(select 1 from public.bling_config c where c.tenant_id=o.tenant_id and c.active)
on conflict (tenant_id,order_id,event_type) do nothing;
commit;
