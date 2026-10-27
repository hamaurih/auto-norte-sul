-- Omnichannel finance bridge: Order Core -> Accounts Receivable -> Cash ledger -> DRE by channel.
-- Cutover remains 2026-10-21. Bling legacy history and unverified bank opening balances are untouched.

alter table public.financial_accounts
  add column if not exists system_code text,
  add column if not exists opening_balance_as_of date,
  add column if not exists opening_balance_verified_at timestamptz,
  add column if not exists opening_balance_verified_by uuid references auth.users(id) on delete set null;

create unique index if not exists financial_accounts_tenant_system_code_uidx
  on public.financial_accounts(tenant_id,system_code)
  where system_code is not null;

alter table public.financial_receivables
  add column if not exists order_id uuid,
  add column if not exists sales_channel_id uuid;

alter table public.financial_transactions
  add column if not exists order_id uuid,
  add column if not exists sales_channel_id uuid,
  add column if not exists payment_method text;

alter table public.expenses
  add column if not exists sales_channel_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='financial_receivables_order_tenant_fk'
      and conrelid='public.financial_receivables'::regclass
  ) then
    alter table public.financial_receivables
      add constraint financial_receivables_order_tenant_fk
      foreign key (order_id,tenant_id)
      references public.orders(id,tenant_id)
      on delete set null (order_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='financial_receivables_channel_tenant_fk'
      and conrelid='public.financial_receivables'::regclass
  ) then
    alter table public.financial_receivables
      add constraint financial_receivables_channel_tenant_fk
      foreign key (sales_channel_id,tenant_id)
      references public.sales_channels(id,tenant_id)
      on delete set null (sales_channel_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='financial_transactions_order_tenant_fk'
      and conrelid='public.financial_transactions'::regclass
  ) then
    alter table public.financial_transactions
      add constraint financial_transactions_order_tenant_fk
      foreign key (order_id,tenant_id)
      references public.orders(id,tenant_id)
      on delete set null (order_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='financial_transactions_channel_tenant_fk'
      and conrelid='public.financial_transactions'::regclass
  ) then
    alter table public.financial_transactions
      add constraint financial_transactions_channel_tenant_fk
      foreign key (sales_channel_id,tenant_id)
      references public.sales_channels(id,tenant_id)
      on delete set null (sales_channel_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='expenses_channel_tenant_fk'
      and conrelid='public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_channel_tenant_fk
      foreign key (sales_channel_id,tenant_id)
      references public.sales_channels(id,tenant_id)
      on delete set null (sales_channel_id);
  end if;
end $$;

alter table public.financial_receivables
  drop constraint if exists financial_receivables_source_type_check;

alter table public.financial_receivables
  add constraint financial_receivables_source_type_check
  check (source_type in (
    'site_order','payment_intent','b2b_order','pos_payment','core_order','manual','bling_backup'
  ));

create unique index if not exists financial_receivables_operational_order_uidx
  on public.financial_receivables(tenant_id,order_id)
  where order_id is not null and source_type <> 'bling_backup';

create unique index if not exists financial_transactions_operational_reference_uidx
  on public.financial_transactions(tenant_id,source_type,external_reference)
  where external_reference is not null
    and source_type in ('order_payment','order_refund','pos_payment','pos_refund','receivable_payment','expense_payment');

-- Stable system account codes. Existing bank/cash balances remain unverified.
update public.financial_accounts
set system_code='cash:main',
    updated_at=now()
where tenant_id in (
  select id from public.tenants where slug='norte-sul-real' and environment='production'
)
  and lower(name)='caixa'
  and system_code is null;

insert into public.financial_accounts(
  tenant_id,name,account_type,institution_name,account_identifier,
  opening_balance,active,system_code,opening_balance_as_of,opening_balance_verified_at
)
select
  t.id,
  x.name,
  x.account_type,
  x.institution_name,
  x.account_identifier,
  0,
  true,
  x.system_code,
  date '2026-10-21',
  now()
from public.tenants t
cross join (values
  ('Asaas — Recebíveis (clearing)','other','Asaas','clearing:asaas','clearing:asaas'),
  ('PDV — Cartões e PIX (clearing)','other','PDV','clearing:pdv-electronic','clearing:pdv-electronic')
) as x(name,account_type,institution_name,account_identifier,system_code)
where t.slug='norte-sul-real' and t.environment='production'
on conflict (tenant_id,system_code)
where system_code is not null
do update set
  name=excluded.name,
  institution_name=excluded.institution_name,
  account_identifier=excluded.account_identifier,
  active=true,
  updated_at=now();

create or replace function private.financial_account_by_system_code(
  p_tenant_id uuid,
  p_system_code text
)
returns uuid
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_id uuid;
begin
  select a.id into v_id
  from public.financial_accounts a
  where a.tenant_id=p_tenant_id
    and a.system_code=p_system_code
    and a.active
  limit 1;

  if v_id is null then
    raise exception 'Conta financeira operacional não configurada: %',p_system_code;
  end if;
  return v_id;
end;
$$;

revoke all on function private.financial_account_by_system_code(uuid,text)
from public,anon,authenticated;

create or replace function private.enrich_receivable_omnichannel_context()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_order_id uuid; v_channel_id uuid;
begin
  v_order_id := new.order_id;

  if v_order_id is null then
    if new.source_type in ('site_order','b2b_order','core_order') then
      v_order_id := new.source_id;
    elsif new.source_type='payment_intent' then
      select pi.order_id into v_order_id
      from public.payment_intents pi
      where pi.tenant_id=new.tenant_id and pi.id=new.source_id;
    elsif new.source_type='pos_payment' then
      select ps.order_id into v_order_id
      from public.pos_payments pp
      join public.pos_sales ps on ps.id=pp.sale_id and ps.tenant_id=pp.tenant_id
      where pp.tenant_id=new.tenant_id and pp.id=new.source_id;
    end if;
  end if;

  if v_order_id is not null then
    select o.sales_channel_id into v_channel_id
    from public.orders o
    where o.tenant_id=new.tenant_id and o.id=v_order_id;

    new.order_id := v_order_id;
    new.sales_channel_id := coalesce(new.sales_channel_id,v_channel_id);
  end if;

  return new;
end;
$$;

revoke all on function private.enrich_receivable_omnichannel_context()
from public,anon,authenticated;

drop trigger if exists trg_enrich_receivable_omnichannel_context on public.financial_receivables;
create trigger trg_enrich_receivable_omnichannel_context
before insert or update of source_type,source_id,order_id,sales_channel_id
on public.financial_receivables
for each row
execute function private.enrich_receivable_omnichannel_context();

create or replace function private.upsert_operational_receivable(
  p_tenant_id uuid,
  p_order_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_amount numeric,
  p_due_date date,
  p_payment_method text,
  p_payment_reference text,
  p_payment_url text,
  p_status text,
  p_received_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_id uuid;
  v_received numeric;
begin
  select * into v_order
  from public.orders
  where tenant_id=p_tenant_id and id=p_order_id;

  if not found then raise exception 'Pedido não encontrado para financeiro'; end if;

  select r.id into v_id
  from public.financial_receivables r
  where r.tenant_id=p_tenant_id
    and r.order_id=p_order_id
    and r.source_type<>'bling_backup'
  order by r.created_at
  limit 1
  for update;

  v_received := case when p_status='received' then p_amount else 0 end;

  if v_id is null then
    insert into public.financial_receivables(
      tenant_id,source_type,source_id,order_id,sales_channel_id,
      customer_id,customer_name,description,amount,due_date,
      payment_method,payment_reference,payment_url,status,
      received_amount,received_at,last_received_at,created_by,updated_by
    )
    values(
      p_tenant_id,p_source_type,p_source_id,p_order_id,v_order.sales_channel_id,
      v_order.customer_id,coalesce(nullif(v_order.customer_name,''),'Cliente'),
      'Pedido '||left(p_order_id::text,8),p_amount,p_due_date,
      p_payment_method,p_payment_reference,p_payment_url,p_status,
      v_received,p_received_at,p_received_at,null,null
    )
    returning id into v_id;
  else
    update public.financial_receivables r
    set sales_channel_id=v_order.sales_channel_id,
        customer_id=v_order.customer_id,
        customer_name=coalesce(nullif(v_order.customer_name,''),r.customer_name),
        amount=p_amount,
        due_date=p_due_date,
        payment_method=coalesce(p_payment_method,r.payment_method),
        payment_reference=coalesce(p_payment_reference,r.payment_reference),
        payment_url=coalesce(p_payment_url,r.payment_url),
        status=p_status,
        received_amount=case
          when p_status='received' then p_amount
          when p_status='cancelled' then 0
          else least(coalesce(r.received_amount,0),p_amount)
        end,
        received_at=case when p_status='received' then coalesce(p_received_at,now()) else null end,
        last_received_at=case when p_status='received' then coalesce(p_received_at,now()) else r.last_received_at end,
        updated_at=now()
    where r.id=v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function private.upsert_operational_receivable(uuid,uuid,text,uuid,numeric,date,text,text,text,text,timestamptz)
from public,anon,authenticated;

create or replace function private.post_operational_cash_movement(
  p_tenant_id uuid,
  p_order_id uuid,
  p_receivable_id uuid,
  p_account_system_code text,
  p_direction text,
  p_amount numeric,
  p_transaction_date date,
  p_payment_method text,
  p_source_type text,
  p_source_id uuid,
  p_external_reference text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_account_id uuid;
  v_channel_id uuid;
  v_tx_id uuid;
begin
  if p_direction not in ('in','out') then raise exception 'Direção financeira inválida'; end if;
  v_account_id := private.financial_account_by_system_code(p_tenant_id,p_account_system_code);

  select o.sales_channel_id into v_channel_id
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;

  select t.id into v_tx_id
  from public.financial_transactions t
  where t.tenant_id=p_tenant_id
    and t.source_type=p_source_type
    and t.external_reference=p_external_reference
  limit 1
  for update;

  if v_tx_id is null then
    insert into public.financial_transactions(
      tenant_id,account_id,transaction_date,direction,amount,description,
      category,source_type,source_id,reconciliation_status,external_reference,
      order_id,sales_channel_id,payment_method,created_by
    )
    values(
      p_tenant_id,v_account_id,p_transaction_date,p_direction,p_amount,p_description,
      case when p_direction='in' then 'venda' else 'estorno' end,
      p_source_type,p_source_id,'matched',p_external_reference,
      p_order_id,v_channel_id,p_payment_method,null
    )
    returning id into v_tx_id;
  end if;

  insert into public.financial_reconciliation_matches(
    tenant_id,transaction_id,target_type,target_id,matched_amount,
    match_method,confidence,matched_by,notes
  )
  values(
    p_tenant_id,v_tx_id,'receivable',p_receivable_id,p_amount,
    case when p_direction='in' then 'provider_confirmation' else 'provider_refund' end,
    1,null,'Vínculo automático Order Core'
  )
  on conflict (transaction_id,target_type,target_id) do nothing;

  update public.financial_transactions
  set reconciliation_status='matched'
  where id=v_tx_id;

  return v_tx_id;
end;
$$;

revoke all on function private.post_operational_cash_movement(uuid,uuid,uuid,text,text,numeric,date,text,text,uuid,text,text)
from public,anon,authenticated;

create or replace function private.financialize_payment_intent()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_receivable_id uuid;
  v_status text;
  v_provider_code text;
  v_account_code text;
  v_due_date date;
begin
  -- Legacy/pre-cutover site activity remains outside the new operational ledger.
  if new.created_at::date < date '2026-10-21' then return new; end if;

  select pp.code into v_provider_code
  from public.payment_providers pp
  where pp.id=new.provider_id;

  v_status := case
    when lower(new.status) in ('paid','received','confirmed','completed') then 'received'
    when lower(new.status) in ('cancelled','canceled','expired','failed','refunded') then 'cancelled'
    else 'open'
  end;

  v_due_date := coalesce(new.expires_at::date,new.created_at::date);

  v_receivable_id := private.upsert_operational_receivable(
    new.tenant_id,new.order_id,'payment_intent',new.id,new.amount,v_due_date,
    new.method,new.external_id,coalesce(new.boleto_url,new.checkout_url),
    v_status,case when v_status='received' then coalesce(new.paid_at,new.updated_at,now()) else null end
  );

  if v_status='received' then
    v_account_code := case when lower(coalesce(v_provider_code,''))='asaas'
      then 'clearing:asaas' else 'clearing:asaas' end;

    perform private.post_operational_cash_movement(
      new.tenant_id,new.order_id,v_receivable_id,v_account_code,'in',new.amount,
      coalesce(new.paid_at::date,current_date),new.method,
      'order_payment',new.id,'payment_intent:'||new.id::text,
      'Recebimento online · pedido '||left(new.order_id::text,8)
    );
  elsif lower(new.status)='refunded' then
    if exists(
      select 1 from public.financial_transactions t
      where t.tenant_id=new.tenant_id
        and t.source_type='order_payment'
        and t.external_reference='payment_intent:'||new.id::text
    ) then
      perform private.post_operational_cash_movement(
        new.tenant_id,new.order_id,v_receivable_id,'clearing:asaas','out',new.amount,
        current_date,new.method,
        'order_refund',new.id,'payment_refund:'||new.id::text,
        'Estorno online · pedido '||left(new.order_id::text,8)
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.financialize_payment_intent()
from public,anon,authenticated;

drop trigger if exists trg_payment_intent_financialize on public.payment_intents;
create trigger trg_payment_intent_financialize
after insert or update
on public.payment_intents
for each row
execute function private.financialize_payment_intent();

create or replace function private.financialize_pos_payment()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_sale public.pos_sales%rowtype;
  v_receivable_id uuid;
  v_received boolean;
  v_account_code text;
begin
  if new.created_at::date < date '2026-10-21' then return new; end if;

  select * into v_sale
  from public.pos_sales
  where tenant_id=new.tenant_id and id=new.sale_id;

  if not found then raise exception 'Venda PDV não encontrada para financeiro'; end if;
  if new.status='confirmed' and v_sale.order_id is null then
    raise exception 'Venda PDV confirmada sem pedido canônico';
  end if;
  if v_sale.order_id is null then return new; end if;

  v_received := new.status='confirmed' and new.method<>'b2b_invoice';

  v_receivable_id := private.upsert_operational_receivable(
    new.tenant_id,v_sale.order_id,'pos_payment',new.id,new.amount,new.created_at::date,
    new.method,new.provider_reference,null,
    case
      when v_received then 'received'
      when new.status in ('cancelled','void','refunded') then 'cancelled'
      else 'open'
    end,
    case when v_received then new.created_at else null end
  );

  if v_received then
    v_account_code := case when new.method='cash' then 'cash:main' else 'clearing:pdv-electronic' end;
    perform private.post_operational_cash_movement(
      new.tenant_id,v_sale.order_id,v_receivable_id,v_account_code,'in',new.amount,
      new.created_at::date,new.method,
      'pos_payment',new.id,'pos_payment:'||new.id::text,
      'Recebimento PDV · venda '||left(new.sale_id::text,8)
    );
  elsif new.status='refunded' then
    v_account_code := case when new.method='cash' then 'cash:main' else 'clearing:pdv-electronic' end;
    if exists(
      select 1 from public.financial_transactions t
      where t.tenant_id=new.tenant_id
        and t.source_type='pos_payment'
        and t.external_reference='pos_payment:'||new.id::text
    ) then
      perform private.post_operational_cash_movement(
        new.tenant_id,v_sale.order_id,v_receivable_id,v_account_code,'out',new.amount,
        current_date,new.method,
        'pos_refund',new.id,'pos_refund:'||new.id::text,
        'Estorno PDV · venda '||left(new.sale_id::text,8)
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.financialize_pos_payment()
from public,anon,authenticated;

drop trigger if exists trg_zz_pos_payment_financialize on public.pos_payments;
create trigger trg_zz_pos_payment_financialize
after insert or update
on public.pos_payments
for each row
execute function private.financialize_pos_payment();

create or replace function private.financialize_assisted_order()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_channel_code text; v_existing uuid;
begin
  if new.created_at::date < date '2026-10-21' then return new; end if;

  select sc.code into v_channel_code
  from public.sales_channels sc
  where sc.id=new.sales_channel_id and sc.tenant_id=new.tenant_id;

  if v_channel_code not in ('whatsapp','vendedor') then return new; end if;

  select r.id into v_existing
  from public.financial_receivables r
  where r.tenant_id=new.tenant_id
    and r.order_id=new.id
    and r.source_type<>'bling_backup'
  limit 1;

  if new.status='cancelado' then
    if v_existing is not null then
      update public.financial_receivables
      set status='cancelled',received_amount=0,received_at=null,updated_at=now()
      where id=v_existing;
    end if;
    return new;
  end if;

  perform private.upsert_operational_receivable(
    new.tenant_id,new.id,'core_order',new.id,new.total,
    new.created_at::date + coalesce(new.payment_due_days,0),
    new.payment_method,null,null,'open',null
  );

  return new;
end;
$$;

revoke all on function private.financialize_assisted_order()
from public,anon,authenticated;

drop trigger if exists trg_orders_financialize_assisted on public.orders;
create trigger trg_orders_financialize_assisted
after insert or update of status,total,sales_channel_id,payment_method,payment_due_days
on public.orders
for each row
execute function private.financialize_assisted_order();

-- Propagate channel/order context to manual receivable receipts.
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
  v_user uuid:=auth.uid();
  v_receivable public.financial_receivables;
  v_account public.financial_accounts;
  v_tx public.financial_transactions;
  v_received numeric(14,2);
  v_remaining numeric(14,2);
  v_status text;
  v_key text;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Valor recebido deve ser maior que zero'; end if;
  if p_account_id is null then raise exception 'Informe a conta financeira de entrada'; end if;

  select * into v_receivable
  from public.financial_receivables
  where id=p_receivable_id
  for update;
  if v_receivable.id is null then raise exception 'Conta a receber não encontrada'; end if;

  if not exists(
    select 1 from public.tenant_memberships m
    where m.user_id=v_user and m.tenant_id=v_receivable.tenant_id
      and m.active and m.role in ('owner','admin','manager','finance')
  ) then raise exception 'Usuário sem permissão para baixar conta a receber'; end if;

  if v_receivable.status in ('canceled','cancelled') then raise exception 'Título cancelado não pode ser baixado'; end if;

  select * into v_account
  from public.financial_accounts
  where id=p_account_id and tenant_id=v_receivable.tenant_id and active
  for update;
  if v_account.id is null then raise exception 'Conta financeira inválida ou inativa'; end if;

  v_key:=nullif(btrim(p_idempotency_key),'');
  if v_key is null then raise exception 'Chave de idempotência obrigatória'; end if;

  select * into v_tx
  from public.financial_transactions
  where tenant_id=v_receivable.tenant_id
    and source_type='receivable_payment'
    and external_reference=v_key
  for update;

  if v_tx.id is not null then
    insert into public.financial_reconciliation_matches(
      tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,matched_by,notes
    ) values(
      v_receivable.tenant_id,v_tx.id,'receivable',v_receivable.id,v_tx.amount,'direct_receipt',1,v_user,p_notes
    ) on conflict (transaction_id,target_type,target_id) do nothing;
    update public.financial_transactions set reconciliation_status='matched' where id=v_tx.id;
    return jsonb_build_object('ok',true,'already_processed',true,'receivable_id',v_receivable.id,'transaction_id',v_tx.id);
  end if;

  v_received:=coalesce(v_receivable.received_amount,0);
  v_remaining:=v_receivable.amount-v_received;
  if v_remaining<=0 or v_receivable.status='received' then
    return jsonb_build_object('ok',true,'already_received',true,'receivable_id',v_receivable.id,'received_amount',v_received);
  end if;
  if p_amount>v_remaining+0.009 then raise exception 'Recebimento de % excede o saldo de %',p_amount,v_remaining; end if;

  insert into public.financial_transactions(
    tenant_id,account_id,transaction_date,direction,amount,description,
    category,cost_center_id,source_type,source_id,reconciliation_status,
    external_reference,created_by,order_id,sales_channel_id,payment_method
  ) values(
    v_receivable.tenant_id,v_account.id,p_received_date,'in',p_amount,
    'Recebimento: '||v_receivable.description,'conta_a_receber',v_receivable.cost_center_id,
    'receivable_payment',v_receivable.id,'matched',v_key,v_user,
    v_receivable.order_id,v_receivable.sales_channel_id,v_receivable.payment_method
  ) returning * into v_tx;

  insert into public.financial_reconciliation_matches(
    tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,matched_by,notes
  ) values(
    v_receivable.tenant_id,v_tx.id,'receivable',v_receivable.id,p_amount,'direct_receipt',1,v_user,p_notes
  );

  v_received:=v_received+p_amount;
  v_status:=case when v_received>=v_receivable.amount-0.009 then 'received' else 'open' end;

  update public.financial_receivables
  set received_amount=v_received,status=v_status,last_received_at=p_received_date::timestamptz,
      received_at=case when v_status='received' then p_received_date::timestamptz else received_at end,
      receipt_account_id=v_account.id,
      notes=case when p_notes is null or btrim(p_notes)='' then notes else coalesce(notes||E'\n','')||p_notes end,
      updated_by=v_user,updated_at=now()
  where id=v_receivable.id;

  return jsonb_build_object(
    'ok',true,'already_processed',false,'receivable_id',v_receivable.id,
    'transaction_id',v_tx.id,'received_amount',v_received,
    'remaining_amount',greatest(v_receivable.amount-v_received,0),'status',v_status
  );
end;
$$;

-- Propagate direct expense channel into cash-out ledger.
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
  v_user uuid:=auth.uid();
  v_expense public.expenses;
  v_account public.financial_accounts;
  v_tx public.financial_transactions;
  v_paid numeric(14,2);
  v_remaining numeric(14,2);
  v_status text;
  v_key text;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Valor de baixa deve ser maior que zero'; end if;
  if p_account_id is null then raise exception 'Informe a conta financeira de saída'; end if;

  select * into v_expense from public.expenses where id=p_expense_id for update;
  if v_expense.id is null then raise exception 'Conta a pagar não encontrada'; end if;

  if not exists(
    select 1 from public.tenant_memberships m
    where m.user_id=v_user and m.tenant_id=v_expense.tenant_id
      and m.active and m.role in ('owner','admin','manager','finance')
  ) then raise exception 'Usuário sem permissão para baixar conta a pagar'; end if;

  if v_expense.approval_status<>'approved' then raise exception 'Título precisa estar aprovado antes da baixa'; end if;
  if v_expense.status in ('canceled','cancelled') then raise exception 'Título cancelado não pode ser baixado'; end if;

  select * into v_account from public.financial_accounts
  where id=p_account_id and tenant_id=v_expense.tenant_id and active for update;
  if v_account.id is null then raise exception 'Conta financeira inválida ou inativa'; end if;

  v_key:=nullif(btrim(p_idempotency_key),'');
  if v_key is null then raise exception 'Chave de idempotência obrigatória'; end if;

  select * into v_tx
  from public.financial_transactions
  where tenant_id=v_expense.tenant_id and source_type='expense_payment' and external_reference=v_key
  for update;

  if v_tx.id is not null then
    insert into public.financial_reconciliation_matches(
      tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,matched_by,notes
    ) values(
      v_expense.tenant_id,v_tx.id,'payable',v_expense.id,v_tx.amount,'direct_payment',1,v_user,p_notes
    ) on conflict (transaction_id,target_type,target_id) do nothing;
    update public.financial_transactions set reconciliation_status='matched' where id=v_tx.id;
    return jsonb_build_object('ok',true,'already_processed',true,'expense_id',v_expense.id,'transaction_id',v_tx.id);
  end if;

  v_paid:=coalesce(v_expense.paid_amount,0);
  v_remaining:=v_expense.amount-v_paid;
  if v_remaining<=0 or v_expense.status='paid' then
    return jsonb_build_object('ok',true,'already_paid',true,'expense_id',v_expense.id,'paid_amount',v_paid);
  end if;
  if p_amount>v_remaining+0.009 then raise exception 'Baixa de % excede o saldo de %',p_amount,v_remaining; end if;

  insert into public.financial_transactions(
    tenant_id,account_id,transaction_date,direction,amount,description,
    category,cost_center_id,source_type,source_id,reconciliation_status,
    external_reference,created_by,sales_channel_id
  ) values(
    v_expense.tenant_id,v_account.id,p_payment_date,'out',p_amount,
    'Pagamento: '||v_expense.description,'conta_a_pagar',v_expense.cost_center_id,
    'expense_payment',v_expense.id,'matched',v_key,v_user,v_expense.sales_channel_id
  ) returning * into v_tx;

  insert into public.financial_reconciliation_matches(
    tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,matched_by,notes
  ) values(
    v_expense.tenant_id,v_tx.id,'payable',v_expense.id,p_amount,'direct_payment',1,v_user,p_notes
  );

  v_paid:=v_paid+p_amount;
  v_status:=case when v_paid>=v_expense.amount-0.009 then 'paid' else 'open' end;

  update public.expenses
  set paid_amount=v_paid,status=v_status,last_paid_at=p_payment_date::timestamptz,
      paid_at=case when v_status='paid' then p_payment_date::timestamptz else paid_at end,
      payment_account_id=v_account.id,
      notes=case when p_notes is null or btrim(p_notes)='' then notes else coalesce(notes||E'\n','')||p_notes end,
      updated_by=v_user,updated_at=now()
  where id=v_expense.id;

  return jsonb_build_object(
    'ok',true,'already_processed',false,'expense_id',v_expense.id,
    'transaction_id',v_tx.id,'paid_amount',v_paid,
    'remaining_amount',greatest(v_expense.amount-v_paid,0),'status',v_status
  );
end;
$$;

-- Management DRE + cash close by channel. Only service_role can execute.
create or replace function public.financial_channel_summary(
  p_tenant_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare v_channels jsonb; v_unallocated numeric; v_unverified integer;
begin
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then
    raise exception 'Período financeiro inválido';
  end if;

  with recognized_orders as (
    select
      o.id,o.sales_channel_id,o.total,o.channel_variable_cost_pct_snapshot,o.channel_fixed_fee_snapshot,
      coalesce(
        (select min(e.created_at)::date from public.order_status_events e
         where e.tenant_id=o.tenant_id and e.order_id=o.id and e.to_status in ('pago','faturado')),
        o.updated_at::date
      ) as competence_date
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.status in ('pago','faturado','enviado','entregue')
  ),
  order_values as (
    select
      r.id,r.sales_channel_id,r.total,
      coalesce(sum(oi.quantity*coalesce(oi.unit_cost_snapshot,0)),0) cogs,
      r.total*coalesce(r.channel_variable_cost_pct_snapshot,0)/100
        +coalesce(r.channel_fixed_fee_snapshot,0) channel_cost
    from recognized_orders r
    left join public.order_items oi
      on oi.order_id=r.id and oi.tenant_id=p_tenant_id
    where r.competence_date between p_start_date and p_end_date
    group by r.id,r.sales_channel_id,r.total,r.channel_variable_cost_pct_snapshot,r.channel_fixed_fee_snapshot
  ),
  sales as (
    select sales_channel_id,count(*) orders,sum(total) revenue,sum(cogs) cogs,sum(channel_cost) channel_cost
    from order_values group by sales_channel_id
  ),
  direct_expenses as (
    select sales_channel_id,sum(amount) amount
    from public.expenses
    where tenant_id=p_tenant_id
      and competence_date between p_start_date and p_end_date
      and approval_status='approved'
      and status<>'canceled'
      and sales_channel_id is not null
    group by sales_channel_id
  ),
  receivables as (
    select sales_channel_id,
      sum(greatest(amount-coalesce(received_amount,0),0)) filter(where status='open') open_amount,
      sum(coalesce(received_amount,0)) received_amount
    from public.financial_receivables
    where tenant_id=p_tenant_id
      and source_type<>'bling_backup'
      and due_date between p_start_date and p_end_date
    group by sales_channel_id
  ),
  cash as (
    select sales_channel_id,
      sum(amount) filter(where direction='in') cash_in,
      sum(amount) filter(where direction='out') cash_out,
      count(*) filter(where reconciliation_status='pending') pending_reconciliation
    from public.financial_transactions
    where tenant_id=p_tenant_id
      and transaction_date between p_start_date and p_end_date
      and source_type is distinct from 'bling_cash_banks'
    group by sales_channel_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel_id',sc.id,
    'code',sc.code,
    'name',sc.name,
    'orders',coalesce(s.orders,0),
    'revenue',coalesce(s.revenue,0),
    'cogs',coalesce(s.cogs,0),
    'channel_cost',coalesce(s.channel_cost,0),
    'direct_expenses',coalesce(de.amount,0),
    'contribution_margin',coalesce(s.revenue,0)-coalesce(s.cogs,0)-coalesce(s.channel_cost,0)-coalesce(de.amount,0),
    'cash_in',coalesce(c.cash_in,0),
    'cash_out',coalesce(c.cash_out,0),
    'net_cash',coalesce(c.cash_in,0)-coalesce(c.cash_out,0),
    'open_receivables',coalesce(r.open_amount,0),
    'received',coalesce(r.received_amount,0),
    'pending_reconciliation',coalesce(c.pending_reconciliation,0)
  ) order by sc.code),'[]'::jsonb)
  into v_channels
  from public.sales_channels sc
  left join sales s on s.sales_channel_id=sc.id
  left join direct_expenses de on de.sales_channel_id=sc.id
  left join receivables r on r.sales_channel_id=sc.id
  left join cash c on c.sales_channel_id=sc.id
  where sc.tenant_id=p_tenant_id and sc.active
    and sc.code in ('site','pdv','whatsapp','vendedor');

  select coalesce(sum(amount),0) into v_unallocated
  from public.expenses
  where tenant_id=p_tenant_id
    and competence_date between p_start_date and p_end_date
    and approval_status='approved'
    and status<>'canceled'
    and sales_channel_id is null;

  select count(*) into v_unverified
  from public.financial_accounts
  where tenant_id=p_tenant_id
    and active
    and name<>'Bling — Caixa/Bancos (histórico)'
    and opening_balance_verified_at is null;

  return jsonb_build_object(
    'start_date',p_start_date,
    'end_date',p_end_date,
    'channels',v_channels,
    'unallocated_expenses',v_unallocated,
    'unverified_opening_accounts',v_unverified,
    'cutover_date','2026-10-21'
  );
end;
$$;

revoke all on function public.financial_channel_summary(uuid,date,date)
from public,anon,authenticated;
grant execute on function public.financial_channel_summary(uuid,date,date)
to service_role;

-- Current-operation backfill: create receivables for current payment intents.
-- No pre-cutover paid transaction is imported into the new ledger.
update public.payment_intents pi
set updated_at=pi.updated_at
where pi.tenant_id in (
  select id from public.tenants where slug='norte-sul-real' and environment='production'
)
  and pi.created_at::date>=date '2026-10-21';

-- Ensure current assisted orders have an open receivable even if created before this trigger.
update public.orders o
set updated_at=o.updated_at
where o.tenant_id in (
  select id from public.tenants where slug='norte-sul-real' and environment='production'
)
  and o.created_at::date>=date '2026-10-21'
  and o.sales_channel_id in (
    select sc.id from public.sales_channels sc
    where sc.tenant_id=o.tenant_id and sc.code in ('whatsapp','vendedor')
  );

comment on column public.financial_accounts.opening_balance_verified_at
is 'Null means the opening balance has NOT been homologated against a real bank/cash closing.';
comment on column public.financial_accounts.system_code
is 'Stable internal identifier for operational/clearing accounts. Never use account name as business logic.';
