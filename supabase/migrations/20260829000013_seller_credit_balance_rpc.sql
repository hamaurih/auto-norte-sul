begin;

create or replace function public.get_seller_credit_balance(
  p_tenant_id uuid,
  p_rep_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;

  if not exists (
    select 1
    from public.sales_reps
    where id = p_rep_id
      and tenant_id = p_tenant_id
  ) then
    raise exception 'vendedor não pertence ao ambiente';
  end if;

  select coalesce(sum(amount), 0)
    into v_balance
  from public.seller_credit_ledger
  where tenant_id = p_tenant_id
    and rep_id = p_rep_id;

  return pg_catalog.round(v_balance, 2);
end;
$$;

revoke all on function public.get_seller_credit_balance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_seller_credit_balance(uuid, uuid)
  to service_role;

create or replace function public.get_seller_credit_balances(
  p_tenant_id uuid
)
returns table (
  rep_id uuid,
  balance numeric
)
language sql
security definer
set search_path = ''
as $$
  select
    rep_id,
    pg_catalog.round(coalesce(sum(amount), 0), 2) as balance
  from public.seller_credit_ledger
  where tenant_id = p_tenant_id
  group by rep_id;
$$;

revoke all on function public.get_seller_credit_balances(uuid)
  from public, anon, authenticated;
grant execute on function public.get_seller_credit_balances(uuid)
  to service_role;

comment on function public.get_seller_credit_balance(uuid, uuid)
  is 'Retorna o saldo completo do crédito comercial de um vendedor; somente service role.';

comment on function public.get_seller_credit_balances(uuid)
  is 'Retorna os saldos completos de crédito do ambiente; somente service role.';

notify pgrst, 'reload schema';

commit;