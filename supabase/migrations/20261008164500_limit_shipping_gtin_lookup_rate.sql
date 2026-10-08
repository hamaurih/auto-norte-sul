-- A fonte secundária gratuita por GTIN permite 100 consultas/dia e possui burst limit.
-- O worker usa apenas 1 produto por ciclo e roda 3 vezes por hora: máximo teórico 72 consultas/dia.
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='norte-sul-shipping-enrichment-autopilot' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

select cron.schedule(
  'norte-sul-shipping-enrichment-autopilot',
  '3,23,43 * * * *',
  'select private.trigger_shipping_enrichment_autopilot();'
);
