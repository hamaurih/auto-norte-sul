-- Scheduler de fallback totalmente interno: pg_cron + pg_net + Supabase Vault.
-- Não depende de CRON_SECRET na Vercel e não grava segredo no Git.
begin;

create extension if not exists pg_net;

-- Cria um token aleatório apenas dentro do banco/Vault. A aplicação nunca
-- recebe este valor fora da requisição autenticada do próprio scheduler.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'enrichment_cron_token'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(48), 'hex'),
      'enrichment_cron_token',
      'Token interno do pg_cron para disparar o autopilot de enriquecimento',
      null
    );
  end if;
end;
$$;

-- O endpoint Vercel chama esta RPC usando service_role para validar o bearer.
-- O segredo fica no Vault; a comparação usa SHA-256 e a função não é exposta
-- a anon/authenticated.
create or replace function public.verify_enrichment_cron_token(p_token text)
returns boolean
language sql
security definer
set search_path=''
as $$
  select coalesce(
    p_token is not null
    and length(p_token) >= 32
    and exists (
      select 1
      from vault.decrypted_secrets s
      where s.name = 'enrichment_cron_token'
        and extensions.digest(p_token, 'sha256') = extensions.digest(s.decrypted_secret, 'sha256')
    ),
    false
  );
$$;

revoke all on function public.verify_enrichment_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_enrichment_cron_token(text) to service_role;

-- Dispara o endpoint de produção sem expor o token no comando do cron.
create or replace function private.trigger_enrichment_autopilot()
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
  where name = 'enrichment_cron_token'
  limit 1;

  if v_token is null then
    raise exception 'Token interno do enriquecimento não encontrado no Vault';
  end if;

  select net.http_get(
    url := 'https://auto-norte-sul.vercel.app/api/public/cron/enrichment',
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'User-Agent', 'NorteSulSupabaseCron/1.0',
      'Accept', 'application/json'
    ),
    timeout_milliseconds := 250000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.trigger_enrichment_autopilot() from public, anon, authenticated;
grant execute on function private.trigger_enrichment_autopilot() to service_role;

-- Garante uma única agenda com nome estável.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'norte-sul-enrichment-autopilot') then
    perform cron.unschedule('norte-sul-enrichment-autopilot');
  end if;

  perform cron.schedule(
    'norte-sul-enrichment-autopilot',
    '*/10 * * * *',
    'select private.trigger_enrichment_autopilot();'
  );
end;
$$;

commit;
