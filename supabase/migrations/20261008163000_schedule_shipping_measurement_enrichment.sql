create or replace function private.trigger_shipping_enrichment_autopilot()
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
    raise exception 'Token interno do enriquecimento não encontrado no Vault';
  end if;

  select net.http_get(
    url := 'https://auto-norte-sul.vercel.app/api/public/cron/shipping-enrichment',
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization','Bearer '||v_token,
      'User-Agent','NorteSulShippingCron/1.0',
      'Accept','application/json'
    ),
    timeout_milliseconds := 250000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.trigger_shipping_enrichment_autopilot() from public, anon, authenticated;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='norte-sul-shipping-enrichment-autopilot' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

select cron.schedule(
  'norte-sul-shipping-enrichment-autopilot',
  '3,13,23,33,43,53 * * * *',
  'select private.trigger_shipping_enrichment_autopilot();'
);
