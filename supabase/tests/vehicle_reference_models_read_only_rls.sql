begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
do $test$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.vehicle_reference_models'::regclass) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon', 'public.vehicle_reference_models', 'SELECT') then raise exception 'anon can read'; end if;
  if has_table_privilege('authenticated', 'public.vehicle_reference_models', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'authenticated can mutate'; end if;
  if not has_table_privilege('service_role', 'public.vehicle_reference_models', 'SELECT,INSERT,UPDATE,DELETE') then raise exception 'backend privileges missing'; end if;
end $test$;
set local role authenticated;
do $test$
declare n integer;
begin
  select count(*) into n from public.vehicle_reference_models;
  if n = 0 then raise exception 'reference catalog not readable'; end if;
  begin
    update public.vehicle_reference_models set active = active where false;
    raise exception 'authenticated UPDATE unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.vehicle_reference_models where false;
    raise exception 'authenticated DELETE unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.vehicle_reference_models(vehicle_make, vehicle_model) select '__security_test__', '__security_test__' where false;
    raise exception 'authenticated INSERT unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $test$;
reset role;
set local role anon;
do $test$
begin
  begin
    perform 1 from public.vehicle_reference_models limit 1;
    raise exception 'anon SELECT unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $test$;
reset role;
select 'VEHICLE_REFERENCE_RLS_OK' as result, count(*) as preserved_reference_count from public.vehicle_reference_models;
rollback;
