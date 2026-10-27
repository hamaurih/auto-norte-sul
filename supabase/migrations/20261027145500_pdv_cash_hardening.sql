begin;

-- Um terminal não pode ter dois caixas abertos ao mesmo tempo.
create unique index if not exists pos_cash_sessions_one_open_terminal_idx
  on public.pos_cash_sessions(tenant_id,terminal_code)
  where status='open';

-- Sangria nunca pode levar o caixa físico projetado abaixo de zero.
create or replace function private.record_pos_cash_movement(
  p_session_id uuid,
  p_type text,
  p_amount numeric,
  p_reason text
)
returns public.pos_cash_movements
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_session public.pos_cash_sessions;
  v_row public.pos_cash_movements;
  v_cash_available numeric(14,2);
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_type not in ('supply','withdrawal')
     or p_amount is null
     or p_amount<=0
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_reason,'')))<3
  then
    raise exception 'INVALID_CASH_MOVEMENT';
  end if;

  select * into v_session
  from public.pos_cash_sessions
  where id=p_session_id and status='open'
  for update;
  if not found then raise exception 'CASH_SESSION_NOT_OPEN'; end if;

  if not exists (
    select 1 from public.tenant_memberships tm
    where tm.tenant_id=v_session.tenant_id
      and tm.user_id=v_user
      and tm.active
      and tm.role in ('owner','admin','manager','cashier')
  ) then raise exception 'FORBIDDEN'; end if;

  if v_session.operator_id<>v_user and not exists (
    select 1 from public.tenant_memberships tm
    where tm.tenant_id=v_session.tenant_id
      and tm.user_id=v_user
      and tm.active
      and tm.role in ('owner','admin','manager')
  ) then raise exception 'SESSION_OWNED_BY_ANOTHER_OPERATOR'; end if;

  if p_type='withdrawal' then
    select pg_catalog.round(
      v_session.opening_amount
      +coalesce((
        select sum(pp.amount)
        from public.pos_sales ps
        join public.pos_payments pp
          on pp.sale_id=ps.id and pp.tenant_id=ps.tenant_id
        where ps.cash_session_id=p_session_id
          and ps.status='paid'
          and pp.method='cash'
          and pp.status='confirmed'
      ),0)
      +coalesce((
        select sum(cm.amount) from public.pos_cash_movements cm
        where cm.cash_session_id=p_session_id and cm.type='supply'
      ),0)
      -coalesce((
        select sum(cm.amount) from public.pos_cash_movements cm
        where cm.cash_session_id=p_session_id and cm.type='withdrawal'
      ),0)
    ,2) into v_cash_available;

    if pg_catalog.round(p_amount,2)>v_cash_available then
      raise exception 'INSUFFICIENT_CASH_DRAWER:%',v_cash_available;
    end if;
  end if;

  insert into public.pos_cash_movements(
    tenant_id,cash_session_id,operator_id,type,amount,reason
  ) values (
    v_session.tenant_id,p_session_id,v_user,p_type,
    pg_catalog.round(p_amount,2),pg_catalog.btrim(p_reason)
  )
  returning * into v_row;

  return v_row;
end
$$;

-- Integridade dos pagamentos também fica protegida no banco.
alter table public.pos_payments
  drop constraint if exists pos_payments_amount_positive;
alter table public.pos_payments
  add constraint pos_payments_amount_positive check (amount>0);

alter table public.pos_payments
  drop constraint if exists pos_payments_installments_range;
alter table public.pos_payments
  add constraint pos_payments_installments_range check (installments between 1 and 24);

alter table public.pos_payments
  drop constraint if exists pos_payments_reference_required;
alter table public.pos_payments
  add constraint pos_payments_reference_required check (
    method not in ('pix','debit_card','credit_card')
    or nullif(pg_catalog.btrim(coalesce(provider_reference,'')),'') is not null
  );

create or replace function private.validate_pos_payment_customer()
returns trigger
language plpgsql
security definer
set search_path=''
as $pdv_customer$
declare
  v_customer uuid;
begin
  if new.method in ('store_credit','b2b_invoice') then
    select s.customer_id into v_customer
    from public.pos_sales s
    where s.id=new.sale_id and s.tenant_id=new.tenant_id;

    if v_customer is null then
      raise exception 'CUSTOMER_REQUIRED_FOR_CREDIT_PAYMENT';
    end if;
  end if;
  return new;
end
$pdv_customer$;

drop trigger if exists trg_pos_payment_customer_required on public.pos_payments;
create trigger trg_pos_payment_customer_required
before insert or update of method,sale_id on public.pos_payments
for each row execute function private.validate_pos_payment_customer();

-- Resumo operacional da sessão, usado pela tela de caixa e pela homologação.
create or replace function public.get_pos_cash_session_snapshot(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_session public.pos_cash_sessions;
  v_cash_sales numeric(14,2):=0;
  v_supplies numeric(14,2):=0;
  v_withdrawals numeric(14,2):=0;
  v_payment_breakdown jsonb:='{}'::jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_session from public.pos_cash_sessions
  where id=p_session_id;

  if not found then raise exception 'CASH_SESSION_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.tenant_memberships tm
    where tm.tenant_id=v_session.tenant_id
      and tm.user_id=v_user and tm.active
      and tm.role in ('owner','admin','manager','cashier')
  ) then raise exception 'FORBIDDEN'; end if;

  select coalesce(sum(pp.amount),0)
  into v_cash_sales
  from public.pos_sales ps
  join public.pos_payments pp on pp.sale_id=ps.id and pp.tenant_id=ps.tenant_id
  where ps.cash_session_id=p_session_id
    and ps.status='paid'
    and pp.method='cash'
    and pp.status='confirmed';

  select
    coalesce(sum(case when type='supply' then amount else 0 end),0),
    coalesce(sum(case when type='withdrawal' then amount else 0 end),0)
  into v_supplies,v_withdrawals
  from public.pos_cash_movements
  where cash_session_id=p_session_id;

  select coalesce(jsonb_object_agg(method,total),'{}'::jsonb)
  into v_payment_breakdown
  from (
    select pp.method,pg_catalog.round(sum(pp.amount),2) total
    from public.pos_sales ps
    join public.pos_payments pp on pp.sale_id=ps.id and pp.tenant_id=ps.tenant_id
    where ps.cash_session_id=p_session_id
      and ps.status='paid'
      and pp.status='confirmed'
    group by pp.method
  ) x;

  return jsonb_build_object(
    'session_id',v_session.id,
    'status',v_session.status,
    'opening_amount',v_session.opening_amount,
    'cash_sales',pg_catalog.round(v_cash_sales,2),
    'supplies',pg_catalog.round(v_supplies,2),
    'withdrawals',pg_catalog.round(v_withdrawals,2),
    'expected_cash',pg_catalog.round(v_session.opening_amount+v_cash_sales+v_supplies-v_withdrawals,2),
    'payment_breakdown',v_payment_breakdown,
    'opened_at',v_session.opened_at,
    'closed_at',v_session.closed_at
  );
end
$$;

revoke all on function public.get_pos_cash_session_snapshot(uuid) from public,anon;
grant execute on function public.get_pos_cash_session_snapshot(uuid) to authenticated,service_role;

commit;