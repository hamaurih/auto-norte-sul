create or replace function private.trigger_bling_order_sync_worker()
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name='enrichment_cron_token'
  limit 1;

  if v_token is null then
    raise exception 'Token interno do worker não encontrado no Vault';
  end if;

  select net.http_get(
    url := 'https://auto-norte-sul.vercel.app/api/public/cron/bling-order-sync',
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization','Bearer '||v_token,
      'User-Agent','NorteSulBlingHybridSync/1.0',
      'Accept','application/json'
    ),
    timeout_milliseconds := 55000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.trigger_bling_order_sync_worker() from public,anon,authenticated;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='norte-sul-bling-hybrid-order-sync' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

select cron.schedule(
  'norte-sul-bling-hybrid-order-sync',
  '* * * * *',
  'select private.trigger_bling_order_sync_worker();'
);
