-- Distinguish storefront sales from generic/default channel and add an independent
-- Supabase pg_cron fallback for the paid-order Bling queue.

insert into public.sales_channels (
  tenant_id, code, name, active, is_default,
  tax_pct, payment_fee_pct, sales_commission_pct, marketplace_fee_pct,
  freight_subsidy_pct, anticipation_pct, expected_loss_pct, other_variable_pct,
  fixed_fee_per_sale
)
select
  t.id, 'site', 'Site / E-commerce', true, false,
  0, 0, 0, 0, 0, 0, 0, 0, 0
from public.tenants t
where t.slug='norte-sul-real' and t.environment='production'
on conflict (tenant_id, code)
do update set
  name=excluded.name,
  active=true,
  is_default=false,
  updated_at=now();

create or replace function private.assign_storefront_site_channel()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_channel_id uuid;
begin
  if new.user_id is not null and new.idempotency_key is not null then
    select sc.id
      into v_channel_id
    from public.sales_channels sc
    where sc.tenant_id=new.tenant_id
      and sc.code='site'
      and sc.active
    limit 1;

    if v_channel_id is not null then
      new.sales_channel_id := v_channel_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.assign_storefront_site_channel() from public,anon,authenticated;

drop trigger if exists trg_00_orders_storefront_channel on public.orders;
create trigger trg_00_orders_storefront_channel
before insert on public.orders
for each row
execute function private.assign_storefront_site_channel();

-- Backfill orders created through the storefront order command. The existing
-- snapshot trigger recalculates the channel-cost snapshot on this update.
update public.orders o
set sales_channel_id=sc.id
from public.sales_channels sc
join public.tenants t on t.id=sc.tenant_id
where o.tenant_id=sc.tenant_id
  and t.slug='norte-sul-real'
  and t.environment='production'
  and sc.code='site'
  and sc.active
  and o.user_id is not null
  and o.idempotency_key is not null
  and o.sales_channel_id is distinct from sc.id;

create or replace function private.trigger_bling_sales_export()
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_token
  from vault.decrypted_secrets
  where name='bling_queue_cron_token'
  limit 1;

  -- Safe no-op until the operational secret is provisioned.
  if nullif(v_token,'') is null then
    return null;
  end if;

  select net.http_get(
    url := 'https://www.nortesulauto.com.br/api/public/cron/bling-sales-export',
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization','Bearer ' || v_token,
      'User-Agent','NorteSulSupabaseCron/1.0',
      'Accept','application/json'
    ),
    timeout_milliseconds := 120000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.trigger_bling_sales_export() from public,anon,authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname='bling-sales-export-fallback'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'bling-sales-export-fallback',
    '*/5 * * * *',
    'select private.trigger_bling_sales_export();'
  );
end;
$$;
