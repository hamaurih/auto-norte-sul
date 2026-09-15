begin;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='run_smart_financial_reconciliation'
  limit 1;

  if v_def is null then
    raise exception 'run_smart_financial_reconciliation não encontrada';
  end if;

  if position('select count(*) from inserted_one_n;' in v_def)=0 then
    raise exception 'Trecho esperado da função não encontrado para hotfix';
  end if;

  v_def := replace(
    v_def,
    'select count(*) from inserted_one_n;',
    'select count(*) into v_created_cases from inserted_one_n;'
  );

  execute v_def;
end;
$$;

commit;
