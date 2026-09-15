begin;

alter table public.expenses
  add column if not exists paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  add column if not exists last_paid_at timestamptz,
  add column if not exists payment_account_id uuid references public.financial_accounts(id);

create unique index if not exists financial_expense_payment_idempotency
  on public.financial_transactions(tenant_id, external_reference)
  where source_type = 'expense_payment' and external_reference is not null;

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
set search_path = ''
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

  select * into v_expense from public.expenses where id = p_expense_id for update;
  if v_expense.id is null then raise exception 'Conta a pagar não encontrada'; end if;

  if not exists (
    select 1 from public.tenant_memberships m
    where m.user_id = v_user and m.tenant_id = v_expense.tenant_id
      and m.active and m.role in ('owner','admin','manager','finance')
  ) then raise exception 'Usuário sem permissão para baixar conta a pagar'; end if;

  select * into v_account from public.financial_accounts
   where id = p_account_id and tenant_id = v_expense.tenant_id and active for update;
  if v_account.id is null then raise exception 'Conta financeira inválida ou inativa'; end if;

  v_paid := coalesce(v_expense.paid_amount,0);
  v_remaining := v_expense.amount - v_paid;
  if v_remaining <= 0 or v_expense.status = 'paid' then
    return jsonb_build_object('ok',true,'already_paid',true,'expense_id',v_expense.id,'paid_amount',v_paid);
  end if;
  if p_amount > v_remaining then raise exception 'Baixa de % excede o saldo de %', p_amount, v_remaining; end if;

  v_key := nullif(btrim(p_idempotency_key), '');
  if v_key is null then
    raise exception 'Chave de idempotência obrigatória';
  end if;

  select * into v_tx from public.financial_transactions
   where tenant_id = v_expense.tenant_id and source_type = 'expense_payment'
     and external_reference = v_key for update;
  if v_tx.id is not null then
    return jsonb_build_object('ok',true,'already_processed',true,'expense_id',v_expense.id,'transaction_id',v_tx.id);
  end if;

  insert into public.financial_transactions
    (tenant_id, account_id, transaction_date, direction, amount, description,
     category, cost_center_id, source_type, source_id, external_reference, created_by)
  values
    (v_expense.tenant_id, v_account.id, p_payment_date, 'out', p_amount,
     'Pagamento: ' || v_expense.description, 'conta_a_pagar', v_expense.cost_center_id,
     'expense_payment', v_expense.id, v_key, v_user)
  returning * into v_tx;

  v_paid := v_paid + p_amount;
  v_status := case when v_paid >= v_expense.amount then 'paid' else 'open' end;

  update public.expenses
     set paid_amount = v_paid,
         status = v_status,
         paid_at = case when v_status = 'paid' then p_payment_date::timestamptz else paid_at end,
         payment_account_id = v_account.id,
         notes = case when p_notes is null or btrim(p_notes) = '' then notes
                      else coalesce(notes || E'\n','') || p_notes end,
         updated_by = v_user,
         updated_at = now()
   where id = v_expense.id;

  return jsonb_build_object('ok',true,'already_processed',false,'expense_id',v_expense.id,
    'transaction_id',v_tx.id,'paid_amount',v_paid,'remaining_amount',greatest(v_expense.amount-v_paid,0),
    'status',v_status);
end;
$$;

revoke all on function public.pay_expense(uuid,numeric,uuid,date,text,text) from public, anon;
grant execute on function public.pay_expense(uuid,numeric,uuid,date,text,text) to authenticated, service_role;

commit;