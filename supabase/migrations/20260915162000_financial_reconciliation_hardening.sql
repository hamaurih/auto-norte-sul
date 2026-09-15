begin;

-- Financial reconciliation hardening: titles <-> cash/bank movements.
alter table public.financial_transactions
  drop constraint if exists financial_transactions_reconciliation_status_check;
alter table public.financial_transactions
  add constraint financial_transactions_reconciliation_status_check
  check (reconciliation_status in ('pending','partial','matched','ignored'));

alter table public.financial_reconciliation_matches
  add column if not exists target_type text,
  add column if not exists target_id uuid,
  add column if not exists matched_amount numeric(14,2),
  add column if not exists match_method text not null default 'manual',
  add column if not exists confidence numeric(5,4),
  add column if not exists source_reference text;

alter table public.financial_reconciliation_matches
  alter column target_type set not null,
  alter column target_id set not null,
  alter column matched_amount set not null;

alter table public.financial_reconciliation_matches
  drop constraint if exists financial_reconciliation_target_type_check;
alter table public.financial_reconciliation_matches
  add constraint financial_reconciliation_target_type_check
  check (target_type in ('receivable','payable'));

alter table public.financial_reconciliation_matches
  drop constraint if exists financial_reconciliation_matched_amount_check;
alter table public.financial_reconciliation_matches
  add constraint financial_reconciliation_matched_amount_check
  check (matched_amount > 0);

alter table public.financial_reconciliation_matches
  drop constraint if exists financial_reconciliation_confidence_check;
alter table public.financial_reconciliation_matches
  add constraint financial_reconciliation_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table public.financial_receivables
  add column if not exists receipt_account_id uuid references public.financial_accounts(id),
  add column if not exists last_received_at timestamptz;

create unique index if not exists financial_reconciliation_pair_unique
  on public.financial_reconciliation_matches(transaction_id,target_type,target_id);
create index if not exists financial_reconciliation_target_idx
  on public.financial_reconciliation_matches(tenant_id,target_type,target_id);
create index if not exists financial_transactions_match_lookup_idx
  on public.financial_transactions(tenant_id,direction,transaction_date,amount);
create unique index if not exists financial_transactions_bling_external_unique
  on public.financial_transactions(tenant_id,external_reference)
  where source_type='bling_cash_banks' and external_reference is not null;
create unique index if not exists financial_receivable_payment_idempotency
  on public.financial_transactions(tenant_id,external_reference)
  where source_type='receivable_payment' and external_reference is not null;

-- Tag historical Bling titles explicitly instead of leaving them as manual/null.
alter table public.financial_receivables
  drop constraint if exists financial_receivables_source_type_check;
alter table public.financial_receivables
  add constraint financial_receivables_source_type_check
  check (source_type in ('site_order','payment_intent','b2b_order','pos_payment','manual','bling_backup'));

update public.financial_receivables r
set source_type='bling_backup', updated_at=now()
where r.source_type='manual'
  and exists (
    select 1
    from public.legacy_import_records l
    where l.entity_type='accounts_receivable'
      and l.migrated_id=r.id
  );

update public.expenses e
set source_type='bling_backup',
    source_id=l.id,
    updated_at=now()
from public.legacy_import_records l
where e.source_type is null
  and l.entity_type='accounts_payable'
  and l.migrated_id=e.id;

create or replace function private.validate_financial_reconciliation_match()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tx public.financial_transactions;
  v_target_tenant uuid;
  v_target_cap numeric(14,2);
  v_used_tx numeric(14,2);
  v_used_target numeric(14,2);
begin
  select * into v_tx
  from public.financial_transactions
  where id=new.transaction_id
  for update;

  if v_tx.id is null then
    raise exception 'Movimento financeiro não encontrado';
  end if;

  if v_tx.tenant_id <> new.tenant_id then
    raise exception 'Movimento e conciliação pertencem a empresas diferentes';
  end if;

  if new.target_type='receivable' then
    if v_tx.direction <> 'in' then
      raise exception 'Conta a receber só pode conciliar movimento de entrada';
    end if;
    select tenant_id, greatest(amount,coalesce(received_amount,0))
      into v_target_tenant, v_target_cap
    from public.financial_receivables
    where id=new.target_id
    for update;
  elsif new.target_type='payable' then
    if v_tx.direction <> 'out' then
      raise exception 'Conta a pagar só pode conciliar movimento de saída';
    end if;
    select tenant_id, greatest(amount,coalesce(paid_amount,0))
      into v_target_tenant, v_target_cap
    from public.expenses
    where id=new.target_id
    for update;
  else
    raise exception 'Tipo de título inválido';
  end if;

  if v_target_tenant is null then
    raise exception 'Título financeiro não encontrado';
  end if;
  if v_target_tenant <> new.tenant_id then
    raise exception 'Título e conciliação pertencem a empresas diferentes';
  end if;

  select coalesce(sum(matched_amount),0)
    into v_used_tx
  from public.financial_reconciliation_matches
  where transaction_id=new.transaction_id
    and id<>new.id;

  if v_used_tx + new.matched_amount > v_tx.amount + 0.009 then
    raise exception 'Valor conciliado excede o valor do movimento';
  end if;

  select coalesce(sum(matched_amount),0)
    into v_used_target
  from public.financial_reconciliation_matches
  where tenant_id=new.tenant_id
    and target_type=new.target_type
    and target_id=new.target_id
    and id<>new.id;

  if v_used_target + new.matched_amount > v_target_cap + 0.009 then
    raise exception 'Valor conciliado excede o valor liquidável do título';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_financial_reconciliation_match
  on public.financial_reconciliation_matches;
create trigger validate_financial_reconciliation_match
before insert or update on public.financial_reconciliation_matches
for each row execute function private.validate_financial_reconciliation_match();

-- Only trusted RPCs may mutate reconciliation rows; finance users may read them.
revoke insert, update, delete on public.financial_reconciliation_matches from authenticated;
grant select on public.financial_reconciliation_matches to authenticated;

create or replace function public.pay_expense(
  p_expense_id uuid,
  p_amount numeric,
  p_account_id uuid,
  p_payment_date date default current_date,
  p_idempotency_key text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_expense public.expenses;
  v_account public.financial_accounts;
  v_tx public.financial_transactions;
  v_paid numeric(14,2);
  v_remaining numeric(14,2);
  v_status text;
  v_key text;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Valor de baixa deve ser maior que zero'; end if;
  if p_account_id is null then raise exception 'Informe a conta financeira de saída'; end if;

  select * into v_expense from public.expenses where id=p_expense_id for update;
  if v_expense.id is null then raise exception 'Conta a pagar não encontrada'; end if;

  if not exists (
    select 1 from public.tenant_memberships m
    where m.user_id=v_user and m.tenant_id=v_expense.tenant_id
      and m.active and m.role in ('owner','admin','manager','finance')
  ) then raise exception 'Usuário sem permissão para baixar conta a pagar'; end if;

  if v_expense.approval_status <> 'approved' then
    raise exception 'Título precisa estar aprovado antes da baixa';
  end if;
  if v_expense.status in ('canceled','cancelled') then
    raise exception 'Título cancelado não pode ser baixado';
  end if;

  select * into v_account
  from public.financial_accounts
  where id=p_account_id and tenant_id=v_expense.tenant_id and active
  for update;
  if v_account.id is null then raise exception 'Conta financeira inválida ou inativa'; end if;

  v_key := nullif(btrim(p_idempotency_key),'');
  if v_key is null then raise exception 'Chave de idempotência obrigatória'; end if;

  select * into v_tx
  from public.financial_transactions
  where tenant_id=v_expense.tenant_id
    and source_type='expense_payment'
    and external_reference=v_key
  for update;

  if v_tx.id is not null then
    insert into public.financial_reconciliation_matches
      (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,matched_by,notes)
    values
      (v_expense.tenant_id,v_tx.id,'payable',v_expense.id,v_tx.amount,'direct_payment',1,v_user,p_notes)
    on conflict (transaction_id,target_type,target_id) do nothing;

    update public.financial_transactions
    set reconciliation_status='matched'
    where id=v_tx.id;

    return jsonb_build_object(
      'ok',true,'already_processed',true,'expense_id',v_expense.id,'transaction_id',v_tx.id
    );
  end if;

  v_paid := coalesce(v_expense.paid_amount,0);
  v_remaining := v_expense.amount-v_paid;
  if v_remaining <= 0 or v_expense.status='paid' then
    return jsonb_build_object('ok',true,'already_paid',true,'expense_id',v_expense.id,'paid_amount',v_paid);
  end if;
  if p_amount > v_remaining + 0.009 then
    raise exception 'Baixa de % excede o saldo de %',p_amount,v_remaining;
  end if;

  insert into public.financial_transactions
    (tenant_id,account_id,transaction_date,direction,amount,description,
     category,cost_center_id,source_type,source_id,reconciliation_status,
     external_reference,created_by)
  values
    (v_expense.tenant_id,v_account.id,p_payment_date,'out',p_amount,
     'Pagamento: '||v_expense.description,'conta_a_pagar',v_expense.cost_center_id,
     'expense_payment',v_expense.id,'pending',v_key,v_user)
  returning * into v_tx;

  insert into public.financial_reconciliation_matches
    (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,matched_by,notes)
  values
    (v_expense.tenant_id,v_tx.id,'payable',v_expense.id,p_amount,'direct_payment',1,v_user,p_notes);

  update public.financial_transactions
  set reconciliation_status='matched'
  where id=v_tx.id;

  v_paid := v_paid+p_amount;
  v_status := case when v_paid >= v_expense.amount-0.009 then 'paid' else 'open' end;

  update public.expenses
  set paid_amount=v_paid,
      status=v_status,
      last_paid_at=p_payment_date::timestamptz,
      paid_at=case when v_status='paid' then p_payment_date::timestamptz else paid_at end,
      payment_account_id=v_account.id,
      notes=case when p_notes is null or btrim(p_notes)='' then notes
                 else coalesce(notes||E'\n','')||p_notes end,
      updated_by=v_user,
      updated_at=now()
  where id=v_expense.id;

  return jsonb_build_object(
    'ok',true,'already_processed',false,'expense_id',v_expense.id,
    'transaction_id',v_tx.id,'paid_amount',v_paid,
    'remaining_amount',greatest(v_expense.amount-v_paid,0),'status',v_status
  );
end;
$$;

create or replace function public.receive_receivable(
  p_receivable_id uuid,
  p_amount numeric,
  p_account_id uuid,
  p_received_date date default current_date,
  p_idempotency_key text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_receivable public.financial_receivables;
  v_account public.financial_accounts;
  v_tx public.financial_transactions;
  v_received numeric(14,2);
  v_remaining numeric(14,2);
  v_status text;
  v_key text;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Valor recebido deve ser maior que zero'; end if;
  if p_account_id is null then raise exception 'Informe a conta financeira de entrada'; end if;

  select * into v_receivable
  from public.financial_receivables
  where id=p_receivable_id
  for update;
  if v_receivable.id is null then raise exception 'Conta a receber não encontrada'; end if;

  if not exists (
    select 1 from public.tenant_memberships m
    where m.user_id=v_user and m.tenant_id=v_receivable.tenant_id
      and m.active and m.role in ('owner','admin','manager','finance')
  ) then raise exception 'Usuário sem permissão para baixar conta a receber'; end if;

  if v_receivable.status in ('canceled','cancelled') then
    raise exception 'Título cancelado não pode ser baixado';
  end if;

  select * into v_account
  from public.financial_accounts
  where id=p_account_id and tenant_id=v_receivable.tenant_id and active
  for update;
  if v_account.id is null then raise exception 'Conta financeira inválida ou inativa'; end if;

  v_key := nullif(btrim(p_idempotency_key),'');
  if v_key is null then raise exception 'Chave de idempotência obrigatória'; end if;

  select * into v_tx
  from public.financial_transactions
  where tenant_id=v_receivable.tenant_id
    and source_type='receivable_payment'
    and external_reference=v_key
  for update;

  if v_tx.id is not null then
    insert into public.financial_reconciliation_matches
      (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,matched_by,notes)
    values
      (v_receivable.tenant_id,v_tx.id,'receivable',v_receivable.id,v_tx.amount,'direct_receipt',1,v_user,p_notes)
    on conflict (transaction_id,target_type,target_id) do nothing;

    update public.financial_transactions
    set reconciliation_status='matched'
    where id=v_tx.id;

    return jsonb_build_object(
      'ok',true,'already_processed',true,'receivable_id',v_receivable.id,'transaction_id',v_tx.id
    );
  end if;

  v_received := coalesce(v_receivable.received_amount,0);
  v_remaining := v_receivable.amount-v_received;
  if v_remaining <= 0 or v_receivable.status='received' then
    return jsonb_build_object('ok',true,'already_received',true,'receivable_id',v_receivable.id,'received_amount',v_received);
  end if;
  if p_amount > v_remaining + 0.009 then
    raise exception 'Recebimento de % excede o saldo de %',p_amount,v_remaining;
  end if;

  insert into public.financial_transactions
    (tenant_id,account_id,transaction_date,direction,amount,description,
     category,cost_center_id,source_type,source_id,reconciliation_status,
     external_reference,created_by)
  values
    (v_receivable.tenant_id,v_account.id,p_received_date,'in',p_amount,
     'Recebimento: '||v_receivable.description,'conta_a_receber',v_receivable.cost_center_id,
     'receivable_payment',v_receivable.id,'pending',v_key,v_user)
  returning * into v_tx;

  insert into public.financial_reconciliation_matches
    (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,matched_by,notes)
  values
    (v_receivable.tenant_id,v_tx.id,'receivable',v_receivable.id,p_amount,'direct_receipt',1,v_user,p_notes);

  update public.financial_transactions
  set reconciliation_status='matched'
  where id=v_tx.id;

  v_received := v_received+p_amount;
  v_status := case when v_received >= v_receivable.amount-0.009 then 'received' else 'open' end;

  update public.financial_receivables
  set received_amount=v_received,
      status=v_status,
      last_received_at=p_received_date::timestamptz,
      received_at=case when v_status='received' then p_received_date::timestamptz else received_at end,
      receipt_account_id=v_account.id,
      notes=case when p_notes is null or btrim(p_notes)='' then notes
                 else coalesce(notes||E'\n','')||p_notes end,
      updated_by=v_user,
      updated_at=now()
  where id=v_receivable.id;

  return jsonb_build_object(
    'ok',true,'already_processed',false,'receivable_id',v_receivable.id,
    'transaction_id',v_tx.id,'received_amount',v_received,
    'remaining_amount',greatest(v_receivable.amount-v_received,0),'status',v_status
  );
end;
$$;

create or replace function public.reconcile_financial_transaction(
  p_transaction_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_amount numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_tx public.financial_transactions;
  v_target_tenant uuid;
  v_target_cap numeric(14,2);
  v_target_status text;
  v_approval_status text;
  v_used_tx numeric(14,2);
  v_used_target numeric(14,2);
  v_match_amount numeric(14,2);
  v_tx_total numeric(14,2);
  v_target_total numeric(14,2);
begin
  if v_user is null then raise exception 'Não autenticado'; end if;

  select * into v_tx
  from public.financial_transactions
  where id=p_transaction_id
  for update;
  if v_tx.id is null then raise exception 'Movimento financeiro não encontrado'; end if;

  if not exists (
    select 1 from public.tenant_memberships m
    where m.user_id=v_user and m.tenant_id=v_tx.tenant_id
      and m.active and m.role in ('owner','admin','manager','finance')
  ) then raise exception 'Usuário sem permissão para conciliar'; end if;

  if v_tx.reconciliation_status='ignored' then
    raise exception 'Movimento ignorado não pode ser conciliado';
  end if;

  if p_target_type='receivable' then
    if v_tx.direction<>'in' then raise exception 'Direção incompatível'; end if;
    select tenant_id,greatest(amount,coalesce(received_amount,0)),status,null::text
      into v_target_tenant,v_target_cap,v_target_status,v_approval_status
    from public.financial_receivables
    where id=p_target_id
    for update;
    if v_target_status in ('canceled','cancelled') then raise exception 'Título cancelado'; end if;
  elsif p_target_type='payable' then
    if v_tx.direction<>'out' then raise exception 'Direção incompatível'; end if;
    select tenant_id,greatest(amount,coalesce(paid_amount,0)),status,approval_status
      into v_target_tenant,v_target_cap,v_target_status,v_approval_status
    from public.expenses
    where id=p_target_id
    for update;
    if v_target_status in ('canceled','cancelled') then raise exception 'Título cancelado'; end if;
    if v_target_status='open' and v_approval_status<>'approved' then
      raise exception 'Conta a pagar precisa estar aprovada';
    end if;
  else
    raise exception 'Tipo de título inválido';
  end if;

  if v_target_tenant is null then raise exception 'Título não encontrado'; end if;
  if v_target_tenant<>v_tx.tenant_id then raise exception 'Título pertence a outra empresa'; end if;

  select coalesce(sum(matched_amount),0) into v_used_tx
  from public.financial_reconciliation_matches
  where transaction_id=v_tx.id;

  select coalesce(sum(matched_amount),0) into v_used_target
  from public.financial_reconciliation_matches
  where tenant_id=v_tx.tenant_id
    and target_type=p_target_type
    and target_id=p_target_id;

  v_match_amount := coalesce(p_amount,least(v_tx.amount-v_used_tx,v_target_cap-v_used_target));
  if v_match_amount is null or v_match_amount<=0 then
    raise exception 'Não há saldo disponível para conciliar';
  end if;

  insert into public.financial_reconciliation_matches
    (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,matched_by,notes)
  values
    (v_tx.tenant_id,v_tx.id,p_target_type,p_target_id,v_match_amount,'manual',1,v_user,p_notes)
  on conflict (transaction_id,target_type,target_id)
  do update set
    matched_amount=excluded.matched_amount,
    matched_at=now(),
    matched_by=excluded.matched_by,
    notes=excluded.notes,
    match_method='manual',
    confidence=1;

  select coalesce(sum(matched_amount),0) into v_tx_total
  from public.financial_reconciliation_matches
  where transaction_id=v_tx.id;

  update public.financial_transactions
  set reconciliation_status=case
    when v_tx_total>=amount-0.009 then 'matched'
    when v_tx_total>0 then 'partial'
    else 'pending'
  end
  where id=v_tx.id;

  select coalesce(sum(matched_amount),0) into v_target_total
  from public.financial_reconciliation_matches
  where tenant_id=v_tx.tenant_id
    and target_type=p_target_type
    and target_id=p_target_id;

  if p_target_type='receivable' then
    update public.financial_receivables
    set received_amount=greatest(received_amount,v_target_total),
        status=case when greatest(received_amount,v_target_total)>=amount-0.009 then 'received' else status end,
        last_received_at=greatest(coalesce(last_received_at,'epoch'::timestamptz),v_tx.transaction_date::timestamptz),
        received_at=case
          when greatest(received_amount,v_target_total)>=amount-0.009
            then coalesce(received_at,v_tx.transaction_date::timestamptz)
          else received_at end,
        receipt_account_id=coalesce(receipt_account_id,v_tx.account_id),
        updated_by=v_user,
        updated_at=now()
    where id=p_target_id;
  else
    update public.expenses
    set paid_amount=greatest(paid_amount,v_target_total),
        status=case when greatest(paid_amount,v_target_total)>=amount-0.009 then 'paid' else status end,
        last_paid_at=greatest(coalesce(last_paid_at,'epoch'::timestamptz),v_tx.transaction_date::timestamptz),
        paid_at=case
          when greatest(paid_amount,v_target_total)>=amount-0.009
            then coalesce(paid_at,v_tx.transaction_date::timestamptz)
          else paid_at end,
        payment_account_id=coalesce(payment_account_id,v_tx.account_id),
        updated_by=v_user,
        updated_at=now()
    where id=p_target_id;
  end if;

  return jsonb_build_object(
    'ok',true,'transaction_id',v_tx.id,'target_type',p_target_type,'target_id',p_target_id,
    'matched_amount',v_match_amount,'transaction_allocated',v_tx_total,'target_allocated',v_target_total
  );
end;
$$;

create or replace function public.auto_reconcile_bling_financials(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_inserted integer := 0;
  v_matched bigint := 0;
  v_partial bigint := 0;
  v_pending bigint := 0;
  v_receivables bigint := 0;
  v_payables bigint := 0;
begin
  if v_user is not null and not exists (
    select 1 from public.tenant_memberships m
    where m.user_id=v_user and m.tenant_id=p_tenant_id
      and m.active and m.role in ('owner','admin')
  ) then
    raise exception 'Somente owner/admin pode executar conciliação histórica automática';
  end if;

  with candidates as (
    select
      t.id transaction_id,
      'receivable'::text target_type,
      r.id target_id,
      t.amount matched_amount,
      count(*) over (partition by r.id) target_candidates,
      count(*) over (partition by t.id) transaction_candidates
    from public.financial_receivables r
    join public.financial_transactions t
      on t.tenant_id=r.tenant_id
     and t.direction='in'
     and t.transaction_date=r.received_at::date
     and t.amount=r.received_amount
     and t.source_type='bling_cash_banks'
     and t.reconciliation_status='pending'
    where r.tenant_id=p_tenant_id
      and r.source_type='bling_backup'
      and r.status='received'
      and r.received_at is not null
      and r.received_amount>0

    union all

    select
      t.id transaction_id,
      'payable'::text target_type,
      e.id target_id,
      t.amount matched_amount,
      count(*) over (partition by e.id) target_candidates,
      count(*) over (partition by t.id) transaction_candidates
    from public.expenses e
    join public.financial_transactions t
      on t.tenant_id=e.tenant_id
     and t.direction='out'
     and t.transaction_date=e.paid_at::date
     and t.amount=e.paid_amount
     and t.source_type='bling_cash_banks'
     and t.reconciliation_status='pending'
    where e.tenant_id=p_tenant_id
      and e.source_type='bling_backup'
      and e.status='paid'
      and e.paid_at is not null
      and e.paid_amount>0
  ),
  qualified as (
    select *
    from candidates
    where target_candidates=1
      and transaction_candidates=1
  )
  insert into public.financial_reconciliation_matches
    (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,source_reference,notes)
  select
    p_tenant_id,q.transaction_id,q.target_type,q.target_id,q.matched_amount,
    'bling_exact_date_amount',1,t.external_reference,
    'Conciliação automática: data de liquidação e valor exatos, correspondência 1:1.'
  from qualified q
  join public.financial_transactions t on t.id=q.transaction_id
  on conflict (transaction_id,target_type,target_id) do nothing;

  get diagnostics v_inserted = row_count;

  update public.financial_transactions t
  set reconciliation_status=case
    when coalesce(x.allocated,0)>=t.amount-0.009 then 'matched'
    when coalesce(x.allocated,0)>0 then 'partial'
    else 'pending'
  end
  from (
    select transaction_id,sum(matched_amount) allocated
    from public.financial_reconciliation_matches
    where tenant_id=p_tenant_id
    group by transaction_id
  ) x
  where t.id=x.transaction_id
    and t.tenant_id=p_tenant_id
    and t.source_type='bling_cash_banks';

  select count(*) filter(where reconciliation_status='matched'),
         count(*) filter(where reconciliation_status='partial'),
         count(*) filter(where reconciliation_status='pending')
    into v_matched,v_partial,v_pending
  from public.financial_transactions
  where tenant_id=p_tenant_id and source_type='bling_cash_banks';

  select count(distinct target_id) filter(where target_type='receivable'),
         count(distinct target_id) filter(where target_type='payable')
    into v_receivables,v_payables
  from public.financial_reconciliation_matches
  where tenant_id=p_tenant_id;

  return jsonb_build_object(
    'ok',true,
    'inserted_matches',v_inserted,
    'matched_movements',v_matched,
    'partial_movements',v_partial,
    'pending_movements',v_pending,
    'linked_receivables',v_receivables,
    'linked_payables',v_payables
  );
end;
$$;

create or replace function public.financial_cash_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_accounts jsonb;
  v_summary jsonb;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  if not exists (
    select 1 from public.tenant_memberships m
    where m.user_id=v_user and m.tenant_id=p_tenant_id
      and m.active and m.role in ('owner','admin','manager','finance')
  ) then raise exception 'Usuário sem permissão financeira'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',a.id,
      'name',a.name,
      'type',a.account_type,
      'institution',a.institution_name,
      'opening_balance',a.opening_balance,
      'balance',a.opening_balance
        + coalesce(x.total_in,0)
        - coalesce(x.total_out,0)
    )
    order by a.name
  ),'[]'::jsonb)
  into v_accounts
  from public.financial_accounts a
  left join (
    select account_id,
      sum(amount) filter(where direction='in') total_in,
      sum(amount) filter(where direction='out') total_out
    from public.financial_transactions
    where tenant_id=p_tenant_id
    group by account_id
  ) x on x.account_id=a.id
  where a.tenant_id=p_tenant_id and a.active;

  select jsonb_build_object(
    'cash_in',coalesce(sum(amount) filter(where direction='in'),0),
    'cash_out',coalesce(sum(amount) filter(where direction='out'),0),
    'movement_balance',
      coalesce(sum(amount) filter(where direction='in'),0)
      - coalesce(sum(amount) filter(where direction='out'),0),
    'pending_movements',count(*) filter(where reconciliation_status='pending'),
    'partial_movements',count(*) filter(where reconciliation_status='partial'),
    'matched_movements',count(*) filter(where reconciliation_status='matched')
  )
  into v_summary
  from public.financial_transactions
  where tenant_id=p_tenant_id;

  return jsonb_build_object('accounts',v_accounts,'summary',v_summary);
end;
$$;

revoke all on function public.pay_expense(uuid,numeric,uuid,date,text,text) from public,anon;
revoke all on function public.receive_receivable(uuid,numeric,uuid,date,text,text) from public,anon;
revoke all on function public.reconcile_financial_transaction(uuid,text,uuid,numeric,text) from public,anon;
revoke all on function public.auto_reconcile_bling_financials(uuid) from public,anon;
revoke all on function public.financial_cash_summary(uuid) from public,anon;

grant execute on function public.pay_expense(uuid,numeric,uuid,date,text,text) to authenticated,service_role;
grant execute on function public.receive_receivable(uuid,numeric,uuid,date,text,text) to authenticated,service_role;
grant execute on function public.reconcile_financial_transaction(uuid,text,uuid,numeric,text) to authenticated,service_role;
grant execute on function public.auto_reconcile_bling_financials(uuid) to authenticated,service_role;
grant execute on function public.financial_cash_summary(uuid) to authenticated,service_role;

commit;
