-- Segurança do scheduler e do claim do worker.
begin;

do $$
declare
  v_secret text;
  v_ok boolean;
  v_fake boolean;
  v_org uuid;
  v_tenant uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_valid_product uuid := gen_random_uuid();
  v_invalid_product uuid := gen_random_uuid();
  v_valid_job uuid := gen_random_uuid();
  v_invalid_job uuid := gen_random_uuid();
  v_claimed integer;
  v_invalid_status text;
  v_invalid_error text;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  -- Token verdadeiro somente é lido dentro da transação no banco.
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'enrichment_cron_token'
  limit 1;
  if v_secret is null then raise exception 'TEST_FAIL scheduler: token do Vault ausente'; end if;

  select public.verify_enrichment_cron_token(v_secret) into v_ok;
  select public.verify_enrichment_cron_token('token-invalido-que-nao-deve-ser-aceito') into v_fake;
  if v_ok is not true then raise exception 'TEST_FAIL scheduler: token verdadeiro rejeitado'; end if;
  if v_fake is not false then raise exception 'TEST_FAIL scheduler: token falso aceito'; end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'norte-sul-enrichment-autopilot'
      and active
      and schedule = '*/10 * * * *'
      and command = 'select private.trigger_enrichment_autopilot();'
  ) then
    raise exception 'TEST_FAIL scheduler: pg_cron não está ativo na frequência esperada';
  end if;

  -- Claim só aceita produto com marca+código+fonte oficial ativa.
  select id into v_org from public.organizations order by created_at limit 1;
  insert into public.tenants(id, organization_id, name, slug, environment, status)
  values (v_tenant, v_org, 'Worker Guard Test', 'worker-guard-'||v_suffix, 'sandbox', 'active');
  insert into public.brands(id, tenant_id, name, slug)
  values (v_brand, v_tenant, 'Worker Guard Brand', 'worker-guard-brand-'||v_suffix);
  insert into public.manufacturer_catalog_sources(tenant_id, brand_id, name, source_kind, base_url, allowed_domains, supported_fields, priority, status)
  values (v_tenant, v_brand, 'Worker Guard Source', 'official_site', 'https://worker-guard.example.com', array['worker-guard.example.com'], array['name'], 100, 'active');

  insert into public.products(id, tenant_id, sku, name, slug, price_b2c, stock, active, brand_id, manufacturer_code)
  values (v_valid_product, v_tenant, 'WG-V-'||v_suffix, 'Worker válido', 'worker-valid-'||v_suffix, 1, 1, true, v_brand, 'WG-100');
  insert into public.products(id, tenant_id, sku, name, slug, price_b2c, stock, active)
  values (v_invalid_product, v_tenant, 'WG-I-'||v_suffix, 'Worker inválido', 'worker-invalid-'||v_suffix, 1, 1, true);

  insert into public.product_enrichment_jobs(id, tenant_id, product_id, trigger_source, status, scheduled_at)
  values
    (v_valid_job, v_tenant, v_valid_product, 'auto', 'queued', now()),
    (v_invalid_job, v_tenant, v_invalid_product, 'bulk', 'queued', now());

  select count(*) into v_claimed from public.claim_product_enrichment_jobs(v_tenant, 5);
  if v_claimed <> 1 then raise exception 'TEST_FAIL worker guard: esperado 1 claim, recebido %', v_claimed; end if;

  select status, last_error into v_invalid_status, v_invalid_error
  from public.product_enrichment_jobs where id = v_invalid_job;
  if v_invalid_status <> 'failed' or coalesce(v_invalid_error,'') not like 'Pré-requisito de enriquecimento ausente:%' then
    raise exception 'TEST_FAIL worker guard: job inválido não foi encerrado corretamente';
  end if;
end $$;

rollback;
