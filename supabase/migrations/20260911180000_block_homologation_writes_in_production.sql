-- Homologation records must never be created against a production tenant.
-- Enforce this at the database layer so a frontend bug cannot turn QA into
-- destructive testing on the live company.

create or replace function private.enforce_non_production_homologation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment text;
begin
  select t.environment into v_environment
  from public.tenants t
  where t.id = new.tenant_id;

  if v_environment is null then
    raise exception 'Tenant de homologação não encontrado'
      using errcode = '23503';
  end if;

  if v_environment = 'production' then
    raise exception 'Operação de homologação bloqueada no tenant de produção'
      using errcode = '23514';
  end if;

  return new;
end
$$;

revoke all on function private.enforce_non_production_homologation()
from public, anon, authenticated;

drop trigger if exists trg_homologation_cases_non_production
  on public.homologation_test_cases;
create trigger trg_homologation_cases_non_production
before insert or update on public.homologation_test_cases
for each row execute function private.enforce_non_production_homologation();

drop trigger if exists trg_homologation_runs_non_production
  on public.homologation_test_runs;
create trigger trg_homologation_runs_non_production
before insert or update on public.homologation_test_runs
for each row execute function private.enforce_non_production_homologation();

notify pgrst, 'reload schema';
