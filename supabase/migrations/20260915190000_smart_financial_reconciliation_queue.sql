begin;

create table if not exists public.financial_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mode text not null default 'analysis',
  status text not null default 'running',
  before_counts jsonb not null default '{}'::jsonb,
  after_counts jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint financial_reconciliation_runs_mode_check check (mode in ('analysis','apply')),
  constraint financial_reconciliation_runs_status_check check (status in ('running','completed','failed'))
);

create table if not exists public.financial_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid references public.financial_reconciliation_runs(id) on delete set null,
  case_type text not null,
  status text not null default 'suggested',
  confidence numeric(5,4) not null default 0,
  fingerprint text not null,
  evidence jsonb not null default '{}'::jsonb,
  total_cash numeric(14,2) not null default 0,
  total_titles numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  auto_eligible boolean not null default false,
  created_by uuid,
  reviewed_by uuid,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint financial_reconciliation_cases_type_check check (
    case_type in ('one_to_one','one_to_many','many_to_one','fee','interest','discount','internal_transfer','other_adjustment','manual_review','unmatched')
  ),
  constraint financial_reconciliation_cases_status_check check (
    status in ('suggested','auto_applied','approved','rejected','reversed','superseded')
  ),
  constraint financial_reconciliation_cases_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint financial_reconciliation_cases_fingerprint_unique unique (tenant_id,fingerprint)
);

create table if not exists public.financial_reconciliation_case_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null references public.financial_reconciliation_cases(id) on delete cascade,
  item_type text not null,
  item_id uuid not null,
  amount numeric(14,2) not null default 0,
  role text not null default 'candidate',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint financial_reconciliation_case_items_type_check check (item_type in ('transaction','receivable','payable')),
  constraint financial_reconciliation_case_items_unique unique(case_id,item_type,item_id,role)
);

create table if not exists public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null references public.financial_reconciliation_cases(id) on delete restrict,
  transaction_id uuid references public.financial_transactions(id) on delete restrict,
  target_type text,
  target_id uuid,
  adjustment_type text not null,
  amount numeric(14,2) not null,
  competence_date date not null,
  category_id uuid references public.expense_categories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  dre_effect text not null default 'none',
  notes text,
  status text not null default 'active',
  created_by uuid,
  created_at timestamptz not null default now(),
  reversed_by uuid,
  reversed_at timestamptz,
  constraint financial_adjustments_target_type_check check (target_type is null or target_type in ('receivable','payable')),
  constraint financial_adjustments_type_check check (adjustment_type in ('bank_fee','interest_income','interest_expense','discount_granted','discount_received','other')),
  constraint financial_adjustments_amount_check check (amount > 0),
  constraint financial_adjustments_dre_check check (dre_effect in ('income','expense','none')),
  constraint financial_adjustments_status_check check (status in ('active','reversed')),
  constraint financial_adjustments_case_unique unique(case_id)
);

create table if not exists public.financial_internal_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null references public.financial_reconciliation_cases(id) on delete restrict,
  out_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  in_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  amount numeric(14,2) not null,
  transfer_date date not null,
  status text not null default 'active',
  created_by uuid,
  created_at timestamptz not null default now(),
  reversed_by uuid,
  reversed_at timestamptz,
  constraint financial_internal_transfers_amount_check check (amount > 0),
  constraint financial_internal_transfers_status_check check (status in ('active','reversed')),
  constraint financial_internal_transfers_distinct_check check (out_transaction_id <> in_transaction_id),
  constraint financial_internal_transfers_case_unique unique(case_id)
);

alter table public.financial_reconciliation_matches
  add column if not exists case_id uuid references public.financial_reconciliation_cases(id) on delete set null;

create index if not exists financial_reconciliation_runs_tenant_idx
  on public.financial_reconciliation_runs(tenant_id,created_at desc);
create index if not exists financial_reconciliation_cases_queue_idx
  on public.financial_reconciliation_cases(tenant_id,status,case_type,confidence desc,created_at desc);
create index if not exists financial_reconciliation_case_items_item_idx
  on public.financial_reconciliation_case_items(tenant_id,item_type,item_id);
create index if not exists financial_adjustments_tenant_idx
  on public.financial_adjustments(tenant_id,status,adjustment_type,competence_date);
create index if not exists financial_internal_transfers_tenant_idx
  on public.financial_internal_transfers(tenant_id,status,transfer_date);
create index if not exists financial_reconciliation_matches_case_idx
  on public.financial_reconciliation_matches(case_id) where case_id is not null;

alter table public.financial_reconciliation_runs enable row level security;
alter table public.financial_reconciliation_cases enable row level security;
alter table public.financial_reconciliation_case_items enable row level security;
alter table public.financial_adjustments enable row level security;
alter table public.financial_internal_transfers enable row level security;

drop policy if exists financial_reconciliation_runs_select_finance on public.financial_reconciliation_runs;
create policy financial_reconciliation_runs_select_finance
on public.financial_reconciliation_runs for select to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager','finance']::text[])));

drop policy if exists financial_reconciliation_cases_select_finance on public.financial_reconciliation_cases;
create policy financial_reconciliation_cases_select_finance
on public.financial_reconciliation_cases for select to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager','finance']::text[])));

drop policy if exists financial_reconciliation_case_items_select_finance on public.financial_reconciliation_case_items;
create policy financial_reconciliation_case_items_select_finance
on public.financial_reconciliation_case_items for select to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager','finance']::text[])));

drop policy if exists financial_adjustments_select_finance on public.financial_adjustments;
create policy financial_adjustments_select_finance
on public.financial_adjustments for select to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager','finance']::text[])));

drop policy if exists financial_internal_transfers_select_finance on public.financial_internal_transfers;
create policy financial_internal_transfers_select_finance
on public.financial_internal_transfers for select to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager','finance']::text[])));

revoke insert,update,delete on public.financial_reconciliation_runs from authenticated;
revoke insert,update,delete on public.financial_reconciliation_cases from authenticated;
revoke insert,update,delete on public.financial_reconciliation_case_items from authenticated;
revoke insert,update,delete on public.financial_adjustments from authenticated;
revoke insert,update,delete on public.financial_internal_transfers from authenticated;
grant select on public.financial_reconciliation_runs,public.financial_reconciliation_cases,public.financial_reconciliation_case_items,public.financial_adjustments,public.financial_internal_transfers to authenticated;
grant all on public.financial_reconciliation_runs,public.financial_reconciliation_cases,public.financial_reconciliation_case_items,public.financial_adjustments,public.financial_internal_transfers to service_role;

create or replace function private.refresh_financial_transaction_reconciliation_status(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_amount numeric(14,2);
  v_current text;
  v_allocated numeric(14,2);
  v_classified boolean;
begin
  select amount,reconciliation_status into v_amount,v_current
  from public.financial_transactions where id=p_transaction_id for update;
  if v_amount is null or v_current='ignored' then return; end if;

  select coalesce(sum(matched_amount),0) into v_allocated
  from public.financial_reconciliation_matches where transaction_id=p_transaction_id;

  select
    exists(select 1 from public.financial_adjustments a where a.transaction_id=p_transaction_id and a.status='active')
    or exists(
      select 1 from public.financial_internal_transfers x
      where x.status='active' and (x.out_transaction_id=p_transaction_id or x.in_transaction_id=p_transaction_id)
    )
  into v_classified;

  update public.financial_transactions
  set reconciliation_status=case
    when v_classified then 'matched'
    when v_allocated >= v_amount-0.009 then 'matched'
    when v_allocated > 0 then 'partial'
    else 'pending'
  end
  where id=p_transaction_id;
end;
$$;

create or replace function private.apply_financial_reconciliation_case(
  p_case_id uuid,
  p_actor uuid,
  p_final_status text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_case public.financial_reconciliation_cases;
  v_tx record;
  v_target record;
  v_adjustment_type text;
  v_dre_effect text;
  v_org uuid;
  v_out public.financial_transactions;
  v_in public.financial_transactions;
  v_match_amount numeric(14,2);
begin
  if p_final_status not in ('auto_applied','approved') then
    raise exception 'Status final de aplicação inválido';
  end if;

  select * into v_case
  from public.financial_reconciliation_cases
  where id=p_case_id
  for update;

  if v_case.id is null then raise exception 'Caso de conciliação não encontrado'; end if;
  if v_case.status in ('auto_applied','approved') then
    return jsonb_build_object('ok',true,'already_applied',true,'case_id',v_case.id,'status',v_case.status);
  end if;
  if v_case.status <> 'suggested' then
    raise exception 'Caso não está disponível para aplicação';
  end if;
  if v_case.case_type in ('unmatched','manual_review') then
    raise exception 'Caso sem determinação segura não pode ser aplicado diretamente';
  end if;

  if v_case.case_type='one_to_one' then
    select i.item_id,i.amount into v_tx
    from public.financial_reconciliation_case_items i
    where i.case_id=v_case.id and i.item_type='transaction' limit 1;

    select i.item_type,i.item_id,i.amount into v_target
    from public.financial_reconciliation_case_items i
    where i.case_id=v_case.id and i.item_type in ('receivable','payable') limit 1;

    if v_tx.item_id is null or v_target.item_id is null then raise exception 'Caso 1:1 incompleto'; end if;

    insert into public.financial_reconciliation_matches
      (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,source_reference,matched_by,notes,case_id)
    values
      (v_case.tenant_id,v_tx.item_id,v_target.item_type,v_target.item_id,
       least(v_tx.amount,v_target.amount),'smart_one_to_one',v_case.confidence,
       'case:'||v_case.id::text,p_actor,'Fila inteligente: principal nominal com evidência forte e relação única.',v_case.id)
    on conflict (transaction_id,target_type,target_id) do nothing;

  elsif v_case.case_type='one_to_many' then
    select i.item_id,i.amount into v_tx
    from public.financial_reconciliation_case_items i
    where i.case_id=v_case.id and i.item_type='transaction' limit 1;
    if v_tx.item_id is null then raise exception 'Caso 1:N sem movimento'; end if;

    for v_target in
      select i.item_type,i.item_id,i.amount
      from public.financial_reconciliation_case_items i
      where i.case_id=v_case.id and i.item_type in ('receivable','payable')
      order by i.item_id
    loop
      insert into public.financial_reconciliation_matches
        (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,source_reference,matched_by,notes,case_id)
      values
        (v_case.tenant_id,v_tx.item_id,v_target.item_type,v_target.item_id,v_target.amount,
         'smart_one_to_many',v_case.confidence,'case:'||v_case.id::text,p_actor,
         'Fila inteligente: um movimento fecha exatamente vários títulos do mesmo favorecido/data.',v_case.id)
      on conflict (transaction_id,target_type,target_id) do nothing;
    end loop;

  elsif v_case.case_type='many_to_one' then
    select i.item_type,i.item_id,i.amount into v_target
    from public.financial_reconciliation_case_items i
    where i.case_id=v_case.id and i.item_type in ('receivable','payable') limit 1;
    if v_target.item_id is null then raise exception 'Caso N:1 sem título'; end if;

    for v_tx in
      select i.item_id,i.amount
      from public.financial_reconciliation_case_items i
      where i.case_id=v_case.id and i.item_type='transaction'
      order by i.item_id
    loop
      insert into public.financial_reconciliation_matches
        (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,source_reference,matched_by,notes,case_id)
      values
        (v_case.tenant_id,v_tx.item_id,v_target.item_type,v_target.item_id,v_tx.amount,
         'smart_many_to_one',v_case.confidence,'case:'||v_case.id::text,p_actor,
         'Fila inteligente: vários movimentos fecham exatamente um título.',v_case.id)
      on conflict (transaction_id,target_type,target_id) do nothing;
    end loop;

  elsif v_case.case_type in ('fee','other_adjustment') then
    select i.item_id,i.amount into v_tx
    from public.financial_reconciliation_case_items i
    where i.case_id=v_case.id and i.item_type='transaction' limit 1;

    v_adjustment_type := coalesce(v_case.evidence->>'adjustment_type','other');
    v_dre_effect := coalesce(v_case.evidence->>'dre_effect','none');

    insert into public.financial_adjustments
      (tenant_id,case_id,transaction_id,adjustment_type,amount,competence_date,dre_effect,notes,status,created_by)
    select v_case.tenant_id,v_case.id,t.id,v_adjustment_type,t.amount,t.transaction_date,v_dre_effect,
           coalesce(v_case.evidence->>'history','Classificação automática da fila inteligente'),'active',p_actor
    from public.financial_transactions t where t.id=v_tx.item_id
    on conflict (case_id) do nothing;

  elsif v_case.case_type in ('interest','discount') then
    select i.item_id,i.amount into v_tx
    from public.financial_reconciliation_case_items i
    where i.case_id=v_case.id and i.item_type='transaction' limit 1;

    select i.item_type,i.item_id,i.amount into v_target
    from public.financial_reconciliation_case_items i
    where i.case_id=v_case.id and i.item_type in ('receivable','payable') limit 1;

    if v_target.item_id is not null then
      v_match_amount := least(v_tx.amount,v_target.amount);
      insert into public.financial_reconciliation_matches
        (tenant_id,transaction_id,target_type,target_id,matched_amount,match_method,confidence,source_reference,matched_by,notes,case_id)
      values
        (v_case.tenant_id,v_tx.item_id,v_target.item_type,v_target.item_id,v_match_amount,
         'smart_'||v_case.case_type,v_case.confidence,'case:'||v_case.id::text,p_actor,
         'Fila inteligente: principal mais ajuste explicitamente identificado.',v_case.id)
      on conflict (transaction_id,target_type,target_id) do nothing;
    end if;

    v_adjustment_type := coalesce(
      v_case.evidence->>'adjustment_type',
      case when v_case.case_type='interest' then 'interest_income' else 'other' end
    );
    v_dre_effect := coalesce(v_case.evidence->>'dre_effect','none');

    insert into public.financial_adjustments
      (tenant_id,case_id,transaction_id,target_type,target_id,adjustment_type,amount,competence_date,dre_effect,notes,status,created_by)
    select v_case.tenant_id,v_case.id,t.id,
           case when v_target.item_id is null then null else v_target.item_type end,
           v_target.item_id,v_adjustment_type,
           case when v_target.item_id is null then t.amount else abs(v_case.difference) end,
           t.transaction_date,v_dre_effect,
           coalesce(v_case.evidence->>'history','Ajuste identificado pela fila inteligente'),'active',p_actor
    from public.financial_transactions t where t.id=v_tx.item_id
    on conflict (case_id) do nothing;

  elsif v_case.case_type='internal_transfer' then
    select t.* into v_out
    from public.financial_reconciliation_case_items i
    join public.financial_transactions t on t.id=i.item_id
    where i.case_id=v_case.id and i.item_type='transaction' and t.direction='out'
    limit 1;

    select t.* into v_in
    from public.financial_reconciliation_case_items i
    join public.financial_transactions t on t.id=i.item_id
    where i.case_id=v_case.id and i.item_type='transaction' and t.direction='in'
    limit 1;

    if v_out.id is null or v_in.id is null then raise exception 'Transferência incompleta'; end if;
    if v_out.account_id=v_in.account_id then
      raise exception 'Transferência exige contas financeiras distintas; mapeamento histórico ainda não disponível';
    end if;
    if abs(v_out.amount-v_in.amount)>0.009 then raise exception 'Valores da transferência não fecham'; end if;

    insert into public.financial_internal_transfers
      (tenant_id,case_id,out_transaction_id,in_transaction_id,amount,transfer_date,status,created_by)
    values
      (v_case.tenant_id,v_case.id,v_out.id,v_in.id,v_out.amount,greatest(v_out.transaction_date,v_in.transaction_date),'active',p_actor)
    on conflict (case_id) do nothing;
  end if;

  update public.financial_reconciliation_cases
  set status=p_final_status,reviewed_by=p_actor,reviewed_at=now(),updated_at=now()
  where id=v_case.id;

  for v_tx in
    select distinct item_id
    from public.financial_reconciliation_case_items
    where case_id=v_case.id and item_type='transaction'
  loop
    perform private.refresh_financial_transaction_reconciliation_status(v_tx.item_id);
  end loop;

  select organization_id into v_org from public.tenants where id=v_case.tenant_id;
  if v_org is not null then
    insert into public.audit_events
      (organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data,metadata)
    values
      (v_org,v_case.tenant_id,p_actor,'financial.reconciliation_case_applied','financial_reconciliation_case',v_case.id::text,
       jsonb_build_object('status',p_final_status,'case_type',v_case.case_type,'confidence',v_case.confidence),
       jsonb_build_object('run_id',v_case.run_id,'fingerprint',v_case.fingerprint));
  end if;

  return jsonb_build_object('ok',true,'case_id',v_case.id,'status',p_final_status,'case_type',v_case.case_type);
end;
$$;

create or replace function public.approve_financial_reconciliation_case(p_case_id uuid,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_tenant uuid;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  select tenant_id into v_tenant from public.financial_reconciliation_cases where id=p_case_id;
  if v_tenant is null then raise exception 'Caso não encontrado'; end if;
  if not private.has_tenant_role(v_tenant,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão financeira';
  end if;
  if p_note is not null then
    update public.financial_reconciliation_cases set review_note=p_note,updated_at=now() where id=p_case_id;
  end if;
  v_result:=private.apply_financial_reconciliation_case(p_case_id,v_user,'approved');
  return v_result;
end;
$$;

create or replace function public.reject_financial_reconciliation_case(p_case_id uuid,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_case public.financial_reconciliation_cases;
  v_org uuid;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  select * into v_case from public.financial_reconciliation_cases where id=p_case_id for update;
  if v_case.id is null then raise exception 'Caso não encontrado'; end if;
  if not private.has_tenant_role(v_case.tenant_id,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão financeira';
  end if;
  if v_case.status<>'suggested' then raise exception 'Somente sugestão pendente pode ser rejeitada'; end if;

  update public.financial_reconciliation_cases
  set status='rejected',reviewed_by=v_user,reviewed_at=now(),review_note=p_note,updated_at=now()
  where id=v_case.id;

  select organization_id into v_org from public.tenants where id=v_case.tenant_id;
  if v_org is not null then
    insert into public.audit_events
      (organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data,metadata)
    values
      (v_org,v_case.tenant_id,v_user,'financial.reconciliation_case_rejected','financial_reconciliation_case',v_case.id::text,
       jsonb_build_object('status','rejected','note',p_note),jsonb_build_object('case_type',v_case.case_type));
  end if;

  return jsonb_build_object('ok',true,'case_id',v_case.id,'status','rejected');
end;
$$;

create or replace function public.reverse_financial_reconciliation_case(p_case_id uuid,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_case public.financial_reconciliation_cases;
  v_tx record;
  v_org uuid;
begin
  if v_user is null then raise exception 'Não autenticado'; end if;
  select * into v_case from public.financial_reconciliation_cases where id=p_case_id for update;
  if v_case.id is null then raise exception 'Caso não encontrado'; end if;
  if not private.has_tenant_role(v_case.tenant_id,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão financeira';
  end if;
  if v_case.status not in ('auto_applied','approved') then
    raise exception 'Somente caso aplicado pode ser revertido';
  end if;

  delete from public.financial_reconciliation_matches where case_id=v_case.id;
  update public.financial_adjustments
    set status='reversed',reversed_by=v_user,reversed_at=now()
    where case_id=v_case.id and status='active';
  update public.financial_internal_transfers
    set status='reversed',reversed_by=v_user,reversed_at=now()
    where case_id=v_case.id and status='active';

  update public.financial_reconciliation_cases
  set status='reversed',reviewed_by=v_user,reviewed_at=now(),review_note=p_reason,updated_at=now()
  where id=v_case.id;

  for v_tx in
    select distinct item_id
    from public.financial_reconciliation_case_items
    where case_id=v_case.id and item_type='transaction'
  loop
    perform private.refresh_financial_transaction_reconciliation_status(v_tx.item_id);
  end loop;

  select organization_id into v_org from public.tenants where id=v_case.tenant_id;
  if v_org is not null then
    insert into public.audit_events
      (organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data,metadata)
    values
      (v_org,v_case.tenant_id,v_user,'financial.reconciliation_case_reversed','financial_reconciliation_case',v_case.id::text,
       jsonb_build_object('status','reversed','reason',p_reason),jsonb_build_object('case_type',v_case.case_type));
  end if;

  return jsonb_build_object('ok',true,'case_id',v_case.id,'status','reversed');
end;
$$;

create or replace function public.financial_reconciliation_queue_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_result jsonb;
begin
  if v_user is not null and not private.has_tenant_role(p_tenant_id,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão financeira';
  end if;

  select jsonb_build_object(
    'transactions',jsonb_build_object(
      'pending',count(*) filter(where reconciliation_status='pending'),
      'partial',count(*) filter(where reconciliation_status='partial'),
      'matched',count(*) filter(where reconciliation_status='matched'),
      'ignored',count(*) filter(where reconciliation_status='ignored')
    )
  ) into v_result
  from public.financial_transactions
  where tenant_id=p_tenant_id and source_type='bling_cash_banks';

  v_result:=v_result||jsonb_build_object(
    'cases',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.case_type,x.status)
      from (
        select case_type,status,count(*)::bigint count,round(coalesce(sum(total_cash),0)::numeric,2) total_cash
        from public.financial_reconciliation_cases
        where tenant_id=p_tenant_id and status<>'superseded'
        group by case_type,status
      ) x
    ),'[]'::jsonb),
    'adjustments',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.adjustment_type)
      from (
        select adjustment_type,dre_effect,count(*)::bigint count,round(sum(amount)::numeric,2) total
        from public.financial_adjustments
        where tenant_id=p_tenant_id and status='active'
        group by adjustment_type,dre_effect
      ) x
    ),'[]'::jsonb),
    'transfers',coalesce((
      select jsonb_build_object('count',count(*)::bigint,'total',round(coalesce(sum(amount),0)::numeric,2))
      from public.financial_internal_transfers
      where tenant_id=p_tenant_id and status='active'
    ),'{}'::jsonb),
    'latest_run',(
      select to_jsonb(x)
      from (
        select id,mode,status,before_counts,after_counts,metrics,created_at,finished_at
        from public.financial_reconciliation_runs
        where tenant_id=p_tenant_id
        order by created_at desc
        limit 1
      ) x
    )
  );

  return v_result;
end;
$$;

create or replace function public.run_smart_financial_reconciliation(
  p_tenant_id uuid,
  p_auto_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_run uuid:=gen_random_uuid();
  v_before jsonb;
  v_after jsonb;
  v_metrics jsonb;
  v_case record;
  v_auto_count integer:=0;
  v_created_cases bigint:=0;
  v_org uuid;
begin
  if v_user is not null and not private.has_tenant_role(p_tenant_id,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão para executar a conciliação';
  end if;

  select jsonb_build_object(
    'pending',count(*) filter(where reconciliation_status='pending'),
    'partial',count(*) filter(where reconciliation_status='partial'),
    'matched',count(*) filter(where reconciliation_status='matched')
  ) into v_before
  from public.financial_transactions
  where tenant_id=p_tenant_id and source_type='bling_cash_banks';

  insert into public.financial_reconciliation_runs(id,tenant_id,mode,status,before_counts,created_by)
  values(v_run,p_tenant_id,case when p_auto_apply then 'apply' else 'analysis' end,'running',v_before,v_user);

  -- Explicit Bling adjustments are classified independently from titles.
  with cash as (
    select t.id,t.amount,t.transaction_date,t.direction,t.external_reference,
           btrim(coalesce(l.payload->>'Categoria','')) category,
           coalesce(l.payload->>'Histórico','') history,
           coalesce(l.payload->>'Cliente','') party
    from public.financial_transactions t
    join public.legacy_import_records l
      on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id
      and t.source_type='bling_cash_banks'
      and t.reconciliation_status='pending'
      and btrim(coalesce(l.payload->>'Categoria','')) in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
  )
  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,v_run,
    case when category='Taxas pagas' then 'fee'
         when category='Juros recebidos' then 'interest'
         else 'other_adjustment' end,
    'suggested',1,
    'explicit-adjustment:'||id::text,
    jsonb_build_object(
      'transaction_id',id,'transaction_date',transaction_date,'direction',direction,'category',category,
      'history',history,'party',party,'external_reference',external_reference,
      'adjustment_type',case when category='Taxas pagas' then 'bank_fee'
                             when category='Juros recebidos' then 'interest_income'
                             else 'other' end,
      'dre_effect',case when category in ('Juros recebidos','Acréscimos recebidos') then 'income' else 'expense' end,
      'reason','Categoria explícita do backup Bling'
    ),
    amount,0,amount,true,v_user
  from cash
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,
        auto_eligible=excluded.auto_eligible,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'transaction_id')::uuid,c.total_cash,'adjustment'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.fingerprint like 'explicit-adjustment:%'
  on conflict (case_id,item_type,item_id,role) do nothing;

  -- Safe nominal 1:1: same settlement date, exact document amount and strong exact metadata; globally unique pair.
  with matched_targets as (
    select target_type,target_id,sum(matched_amount) allocated
    from public.financial_reconciliation_matches
    where tenant_id=p_tenant_id group by target_type,target_id
  ),
  cash as (
    select t.id,t.direction,t.transaction_date,t.amount,t.external_reference,
           lower(btrim(coalesce(l.payload->>'Cliente',''))) party,
           lower(btrim(coalesce(l.payload->>'Histórico',''))) history
    from public.financial_transactions t
    join public.legacy_import_records l on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id and t.source_type='bling_cash_banks' and t.reconciliation_status='pending'
      and btrim(coalesce(l.payload->>'Categoria','')) not in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
      and not exists (
        select 1 from public.financial_reconciliation_case_items i
        join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=t.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  ),
  titles as (
    select 'receivable'::text target_type,r.id target_id,r.received_at::date settled_date,r.amount::numeric amount,
           lower(btrim(coalesce(l.payload->>'Cliente',r.customer_name,''))) party,
           lower(btrim(coalesce(l.payload->>'Histórico',''))) history
    from public.financial_receivables r
    join public.legacy_import_records l on l.tenant_id=r.tenant_id and l.entity_type='accounts_receivable' and l.migrated_id=r.id
    left join matched_targets m on m.target_type='receivable' and m.target_id=r.id
    where r.tenant_id=p_tenant_id and r.source_type='bling_backup' and r.status='received' and r.received_at is not null
      and coalesce(m.allocated,0)<0.009
      and not exists (
        select 1 from public.financial_reconciliation_case_items i
        join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='receivable' and i.item_id=r.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
    union all
    select 'payable',e.id,e.paid_at::date,e.amount::numeric,
           lower(btrim(coalesce(l.payload->>'Fornecedor',e.supplier_name,''))),
           lower(btrim(coalesce(l.payload->>'Histórico','')))
    from public.expenses e
    join public.legacy_import_records l on l.tenant_id=e.tenant_id and l.entity_type='accounts_payable' and l.migrated_id=e.id
    left join matched_targets m on m.target_type='payable' and m.target_id=e.id
    where e.tenant_id=p_tenant_id and e.source_type='bling_backup' and e.status='paid' and e.paid_at is not null
      and coalesce(m.allocated,0)<0.009
      and not exists (
        select 1 from public.financial_reconciliation_case_items i
        join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='payable' and i.item_id=e.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  ),
  candidates as (
    select c.id transaction_id,c.amount cash_amount,c.transaction_date,c.party cash_party,c.history cash_history,
           t.target_type,t.target_id,t.amount title_amount,t.party target_party,t.history target_history,
           count(*) over(partition by c.id) tx_candidates,
           count(*) over(partition by t.target_type,t.target_id) target_candidates
    from cash c join titles t
      on t.settled_date=c.transaction_date
     and ((c.direction='in' and t.target_type='receivable') or (c.direction='out' and t.target_type='payable'))
     and abs(t.amount-c.amount)<0.009
     and ((c.party<>'' and c.party=t.party) or (c.history<>'' and c.history=t.history))
  ),
  safe as (
    select * from candidates where tx_candidates=1 and target_candidates=1
  )
  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,v_run,'one_to_one','suggested',1,
         'one-to-one:'||transaction_id::text||':'||target_type||':'||target_id::text,
         jsonb_build_object(
           'transaction_id',transaction_id,'target_type',target_type,'target_id',target_id,
           'transaction_date',transaction_date,'party',cash_party,'cash_history',cash_history,'target_history',target_history,
           'party_match',(cash_party<>'' and cash_party=target_party),
           'history_match',(cash_history<>'' and cash_history=target_history),
           'reason','Data e valor nominal exatos; cliente/fornecedor ou histórico exato; relação única'
         ),
         cash_amount,title_amount,cash_amount-title_amount,true,v_user
  from safe
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,
        auto_eligible=excluded.auto_eligible,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'transaction_id')::uuid,c.total_cash,'cash'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type='one_to_one'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,c.evidence->>'target_type',(c.evidence->>'target_id')::uuid,c.total_titles,'title'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type='one_to_one'
  on conflict (case_id,item_type,item_id,role) do nothing;

  -- Safe 1:N and N:1 whole-group matching. No combinatorial guessing: the complete party/date group must close exactly.
  with matched_targets as (
    select target_type,target_id,sum(matched_amount) allocated
    from public.financial_reconciliation_matches where tenant_id=p_tenant_id group by target_type,target_id
  ),
  cash_pool as (
    select t.id,t.direction,t.transaction_date,t.amount,
           lower(btrim(coalesce(l.payload->>'Cliente',''))) party
    from public.financial_transactions t
    join public.legacy_import_records l on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id and t.source_type='bling_cash_banks' and t.reconciliation_status='pending'
      and btrim(coalesce(l.payload->>'Categoria','')) not in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
      and not exists (
        select 1 from public.financial_reconciliation_case_items i
        join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=t.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  ),
  title_pool as (
    select 'receivable'::text target_type,r.id target_id,r.received_at::date settled_date,r.amount::numeric amount,
           lower(btrim(coalesce(l.payload->>'Cliente',r.customer_name,''))) party
    from public.financial_receivables r
    join public.legacy_import_records l on l.tenant_id=r.tenant_id and l.entity_type='accounts_receivable' and l.migrated_id=r.id
    left join matched_targets m on m.target_type='receivable' and m.target_id=r.id
    where r.tenant_id=p_tenant_id and r.source_type='bling_backup' and r.status='received' and r.received_at is not null
      and coalesce(m.allocated,0)<0.009
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='receivable' and i.item_id=r.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
    union all
    select 'payable',e.id,e.paid_at::date,e.amount::numeric,
           lower(btrim(coalesce(l.payload->>'Fornecedor',e.supplier_name,'')))
    from public.expenses e
    join public.legacy_import_records l on l.tenant_id=e.tenant_id and l.entity_type='accounts_payable' and l.migrated_id=e.id
    left join matched_targets m on m.target_type='payable' and m.target_id=e.id
    where e.tenant_id=p_tenant_id and e.source_type='bling_backup' and e.status='paid' and e.paid_at is not null
      and coalesce(m.allocated,0)<0.009
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='payable' and i.item_id=e.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  ),
  cg as (
    select direction,transaction_date,party,count(*) tx_count,sum(amount) tx_sum,
           (array_agg(id order by id::text))[1] only_tx,
           array_agg(id order by id::text) tx_ids
    from cash_pool where party<>'' group by direction,transaction_date,party
  ),
  tg as (
    select target_type,settled_date,party,count(*) title_count,sum(amount) title_sum,
           array_agg(target_id order by target_id::text) target_ids
    from title_pool where party<>'' group by target_type,settled_date,party
  ),
  one_n as (
    select cg.*,tg.target_type,tg.title_count,tg.title_sum,tg.target_ids
    from cg join tg on tg.settled_date=cg.transaction_date and tg.party=cg.party
      and ((cg.direction='in' and tg.target_type='receivable') or (cg.direction='out' and tg.target_type='payable'))
    where cg.tx_count=1 and tg.title_count between 2 and 6 and abs(cg.tx_sum-tg.title_sum)<0.009
  ),
  n_one as (
    select cg.*,tg.target_type,tg.title_count,tg.title_sum,tg.target_ids
    from cg join tg on tg.settled_date=cg.transaction_date and tg.party=cg.party
      and ((cg.direction='in' and tg.target_type='receivable') or (cg.direction='out' and tg.target_type='payable'))
    where cg.tx_count between 2 and 6 and tg.title_count=1 and abs(cg.tx_sum-tg.title_sum)<0.009
  ),
  inserted_one_n as (
    insert into public.financial_reconciliation_cases
      (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
    select p_tenant_id,v_run,'one_to_many','suggested',1,
      'one-to-many:'||only_tx::text||':'||md5(array_to_string(target_ids,',')),
      jsonb_build_object('transaction_id',only_tx,'target_type',target_type,'target_ids',to_jsonb(target_ids),
        'transaction_date',transaction_date,'party',party,'reason','Um movimento e todos os títulos do favorecido/data fecham exatamente'),
      tx_sum,title_sum,tx_sum-title_sum,true,v_user
    from one_n
    on conflict (tenant_id,fingerprint) do update
      set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,auto_eligible=excluded.auto_eligible,updated_at=now()
    where public.financial_reconciliation_cases.status='suggested'
    returning id
  )
  select count(*) from inserted_one_n;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'transaction_id')::uuid,c.total_cash,'cash'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type='one_to_many'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,c.evidence->>'target_type',j.value::uuid,
         case when c.evidence->>'target_type'='receivable' then r.amount else e.amount end,'title'
  from public.financial_reconciliation_cases c
  cross join lateral jsonb_array_elements_text(c.evidence->'target_ids') j(value)
  left join public.financial_receivables r on c.evidence->>'target_type'='receivable' and r.id=j.value::uuid
  left join public.expenses e on c.evidence->>'target_type'='payable' and e.id=j.value::uuid
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type='one_to_many'
  on conflict (case_id,item_type,item_id,role) do nothing;

  -- Recompute remaining pool for N:1 after 1:N cases were inserted.
  with matched_targets as (
    select target_type,target_id,sum(matched_amount) allocated
    from public.financial_reconciliation_matches where tenant_id=p_tenant_id group by target_type,target_id
  ),
  cash_pool as (
    select t.id,t.direction,t.transaction_date,t.amount,
           lower(btrim(coalesce(l.payload->>'Cliente',''))) party
    from public.financial_transactions t
    join public.legacy_import_records l on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id and t.source_type='bling_cash_banks' and t.reconciliation_status='pending'
      and btrim(coalesce(l.payload->>'Categoria','')) not in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=t.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  ),
  title_pool as (
    select 'receivable'::text target_type,r.id target_id,r.received_at::date settled_date,r.amount::numeric amount,
           lower(btrim(coalesce(l.payload->>'Cliente',r.customer_name,''))) party
    from public.financial_receivables r
    join public.legacy_import_records l on l.tenant_id=r.tenant_id and l.entity_type='accounts_receivable' and l.migrated_id=r.id
    left join matched_targets m on m.target_type='receivable' and m.target_id=r.id
    where r.tenant_id=p_tenant_id and r.source_type='bling_backup' and r.status='received' and r.received_at is not null
      and coalesce(m.allocated,0)<0.009
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='receivable' and i.item_id=r.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
    union all
    select 'payable',e.id,e.paid_at::date,e.amount::numeric,
           lower(btrim(coalesce(l.payload->>'Fornecedor',e.supplier_name,'')))
    from public.expenses e
    join public.legacy_import_records l on l.tenant_id=e.tenant_id and l.entity_type='accounts_payable' and l.migrated_id=e.id
    left join matched_targets m on m.target_type='payable' and m.target_id=e.id
    where e.tenant_id=p_tenant_id and e.source_type='bling_backup' and e.status='paid' and e.paid_at is not null
      and coalesce(m.allocated,0)<0.009
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='payable' and i.item_id=e.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  ),
  cg as (
    select direction,transaction_date,party,count(*) tx_count,sum(amount) tx_sum,array_agg(id order by id::text) tx_ids
    from cash_pool where party<>'' group by direction,transaction_date,party
  ),
  tg as (
    select target_type,settled_date,party,count(*) title_count,sum(amount) title_sum,
           (array_agg(target_id order by target_id::text))[1] only_target
    from title_pool where party<>'' group by target_type,settled_date,party
  ),
  safe as (
    select cg.*,tg.target_type,tg.only_target,tg.title_sum
    from cg join tg on tg.settled_date=cg.transaction_date and tg.party=cg.party
      and ((cg.direction='in' and tg.target_type='receivable') or (cg.direction='out' and tg.target_type='payable'))
    where cg.tx_count between 2 and 6 and tg.title_count=1 and abs(cg.tx_sum-tg.title_sum)<0.009
  )
  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,v_run,'many_to_one','suggested',1,
    'many-to-one:'||target_type||':'||only_target::text||':'||md5(array_to_string(tx_ids,',')),
    jsonb_build_object('transaction_ids',to_jsonb(tx_ids),'target_type',target_type,'target_id',only_target,
      'transaction_date',transaction_date,'party',party,'reason','Todos os movimentos do favorecido/data fecham exatamente um único título'),
    tx_sum,title_sum,tx_sum-title_sum,true,v_user
  from safe
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,auto_eligible=excluded.auto_eligible,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',j.value::uuid,t.amount,'cash'
  from public.financial_reconciliation_cases c
  cross join lateral jsonb_array_elements_text(c.evidence->'transaction_ids') j(value)
  join public.financial_transactions t on t.id=j.value::uuid
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type='many_to_one'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,c.evidence->>'target_type',(c.evidence->>'target_id')::uuid,c.total_titles,'title'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type='many_to_one'
  on conflict (case_id,item_type,item_id,role) do nothing;

  -- Explicit combined interest/discount when text proves the nature of the difference.
  with cash as (
    select t.id,t.direction,t.transaction_date,t.amount,
           lower(btrim(coalesce(l.payload->>'Cliente',''))) party,
           lower(btrim(coalesce(l.payload->>'Histórico',''))) history
    from public.financial_transactions t
    join public.legacy_import_records l on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id and t.source_type='bling_cash_banks' and t.reconciliation_status='pending'
      and btrim(coalesce(l.payload->>'Categoria','')) not in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=t.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  ),
  titles as (
    select 'receivable'::text target_type,r.id target_id,r.received_at::date settled_date,r.amount::numeric amount,
           lower(btrim(coalesce(l.payload->>'Cliente',r.customer_name,''))) party,
           lower(btrim(coalesce(l.payload->>'Histórico',''))) history
    from public.financial_receivables r
    join public.legacy_import_records l on l.tenant_id=r.tenant_id and l.entity_type='accounts_receivable' and l.migrated_id=r.id
    where r.tenant_id=p_tenant_id and r.source_type='bling_backup' and r.status='received' and r.received_at is not null
      and not exists(select 1 from public.financial_reconciliation_matches m where m.tenant_id=p_tenant_id and m.target_type='receivable' and m.target_id=r.id)
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='receivable' and i.item_id=r.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
    union all
    select 'payable',e.id,e.paid_at::date,e.amount::numeric,
           lower(btrim(coalesce(l.payload->>'Fornecedor',e.supplier_name,''))),
           lower(btrim(coalesce(l.payload->>'Histórico','')))
    from public.expenses e
    join public.legacy_import_records l on l.tenant_id=e.tenant_id and l.entity_type='accounts_payable' and l.migrated_id=e.id
    where e.tenant_id=p_tenant_id and e.source_type='bling_backup' and e.status='paid' and e.paid_at is not null
      and not exists(select 1 from public.financial_reconciliation_matches m where m.tenant_id=p_tenant_id and m.target_type='payable' and m.target_id=e.id)
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='payable' and i.item_id=e.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  ),
  raw as (
    select c.*,t.target_type,t.target_id,t.amount title_amount,t.history target_history,
      case
        when c.amount<t.amount and (c.history like '%desconto%' or c.history like '%abatimento%' or t.history like '%desconto%' or t.history like '%abatimento%') then 'discount'
        when c.amount>t.amount and (c.history like '%juros%' or c.history like '%multa%' or t.history like '%juros%' or t.history like '%multa%') then 'interest'
      end detected_type,
      count(*) over(partition by c.id) tx_candidates,
      count(*) over(partition by t.target_type,t.target_id) target_candidates
    from cash c join titles t on t.settled_date=c.transaction_date
      and ((c.direction='in' and t.target_type='receivable') or (c.direction='out' and t.target_type='payable'))
      and ((c.party<>'' and c.party=t.party) or (c.history<>'' and c.history=t.history))
      and abs(c.amount-t.amount)>=0.009
  ),
  safe as (
    select * from raw where detected_type is not null and tx_candidates=1 and target_candidates=1
  )
  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,v_run,detected_type,'suggested',1,
    detected_type||'-difference:'||id::text||':'||target_type||':'||target_id::text,
    jsonb_build_object('transaction_id',id,'target_type',target_type,'target_id',target_id,'transaction_date',transaction_date,
      'party',party,'cash_history',history,'target_history',target_history,
      'adjustment_type',
        case when detected_type='discount' and target_type='receivable' then 'discount_granted'
             when detected_type='discount' and target_type='payable' then 'discount_received'
             when detected_type='interest' and target_type='receivable' then 'interest_income'
             else 'interest_expense' end,
      'dre_effect',
        case when detected_type='discount' and target_type='receivable' then 'expense'
             when detected_type='discount' and target_type='payable' then 'income'
             when detected_type='interest' and target_type='receivable' then 'income'
             else 'expense' end,
      'reason','Natureza da diferença aparece explicitamente no histórico e o par é único'),
    amount,title_amount,amount-title_amount,true,v_user
  from safe
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,auto_eligible=excluded.auto_eligible,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'transaction_id')::uuid,c.total_cash,'cash'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type in ('interest','discount')
    and c.evidence ? 'target_id'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,c.evidence->>'target_type',(c.evidence->>'target_id')::uuid,c.total_titles,'title'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type in ('interest','discount')
    and c.evidence ? 'target_id'
  on conflict (case_id,item_type,item_id,role) do nothing;

  -- Internal transfer suggestions: unique opposite-direction pair. Historical Bling account collapsed to one staging account,
  -- therefore these are never auto-applied until real source/destination accounts are mapped.
  with cash as (
    select t.id,t.direction,t.transaction_date,t.amount,t.account_id,
           lower(btrim(coalesce(l.payload->>'Histórico',''))) history
    from public.financial_transactions t
    join public.legacy_import_records l on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id and t.source_type='bling_cash_banks' and t.reconciliation_status='pending'
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=t.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  ),
  pairs as (
    select o.id out_id,i.id in_id,o.amount,o.transaction_date,o.history out_history,i.history in_history,
      count(*) over(partition by o.id) out_candidates,
      count(*) over(partition by i.id) in_candidates
    from cash o join cash i on o.direction='out' and i.direction='in'
      and o.transaction_date=i.transaction_date and abs(o.amount-i.amount)<0.009
      and o.id<>i.id
      and (
        o.history like '%transfer%' or o.history like '%transf%' or o.history like '% ted %' or o.history like '%entre contas%'
        or i.history like '%transfer%' or i.history like '%transf%' or i.history like '% ted %' or i.history like '%entre contas%'
      )
  ),
  safe as (
    select * from pairs where out_candidates=1 and in_candidates=1
  )
  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,v_run,'internal_transfer','suggested',0.85,
    'internal-transfer:'||out_id::text||':'||in_id::text,
    jsonb_build_object('out_transaction_id',out_id,'in_transaction_id',in_id,'transaction_date',transaction_date,
      'out_history',out_history,'in_history',in_history,'account_mapping_required',true,
      'reason','Par entrada/saída único por data e valor com indicação textual de transferência; contas históricas ainda colapsadas'),
    amount,amount,0,false,v_user
  from safe
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,auto_eligible=false,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'out_transaction_id')::uuid,c.total_cash,'source'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type='internal_transfer'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'in_transaction_id')::uuid,c.total_cash,'destination'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type='internal_transfer'
  on conflict (case_id,item_type,item_id,role) do nothing;

  -- Supersede an old unresolved marker when a stronger candidate now exists for the same transaction.
  update public.financial_reconciliation_cases u
  set status='superseded',updated_at=now()
  where u.tenant_id=p_tenant_id and u.case_type='unmatched' and u.status='suggested'
    and exists (
      select 1 from public.financial_reconciliation_case_items ui
      where ui.case_id=u.id and ui.item_type='transaction'
        and exists (
          select 1 from public.financial_reconciliation_case_items oi
          join public.financial_reconciliation_cases oc on oc.id=oi.case_id
          where oi.tenant_id=p_tenant_id and oi.item_type='transaction' and oi.item_id=ui.item_id
            and oc.id<>u.id and oc.case_type<>'unmatched' and oc.status in ('suggested','auto_applied','approved')
        )
    );

  -- Anything still unresolved becomes a manual queue item, not an automatic guess.
  with unresolved as (
    select t.id,t.amount,t.transaction_date,t.direction,t.description,t.external_reference,
           coalesce(l.payload->>'Cliente','') party,
           coalesce(l.payload->>'Histórico','') history,
           coalesce(l.payload->>'Categoria','') category
    from public.financial_transactions t
    left join public.legacy_import_records l on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id and t.source_type='bling_cash_banks' and t.reconciliation_status='pending'
      and not exists (
        select 1 from public.financial_reconciliation_case_items i join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=t.id
          and c.status in ('suggested','auto_applied','approved') and c.case_type<>'unmatched'
      )
  )
  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,v_run,'unmatched','suggested',0,
    'unmatched:'||id::text,
    jsonb_build_object('transaction_id',id,'transaction_date',transaction_date,'direction',direction,'description',description,
      'external_reference',external_reference,'party',party,'history',history,'category',category,
      'reason','Nenhuma relação determinística e única foi comprovada'),
    amount,0,amount,false,v_user
  from unresolved
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'transaction_id')::uuid,c.total_cash,'unresolved'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=v_run and c.case_type='unmatched'
  on conflict (case_id,item_type,item_id,role) do nothing;

  -- Enrich queue evidence without exposing raw payloads to the frontend.
  update public.financial_reconciliation_case_items i
  set metadata=jsonb_strip_nulls(jsonb_build_object(
    'date',t.transaction_date,'direction',t.direction,'description',t.description,'amount',t.amount,
    'external_reference',t.external_reference,'reconciliation_status',t.reconciliation_status,
    'party',l.payload->>'Cliente','history',l.payload->>'Histórico','category',l.payload->>'Categoria'
  ))
  from public.financial_transactions t
  left join public.legacy_import_records l
    on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
  where i.case_id in (select id from public.financial_reconciliation_cases where tenant_id=p_tenant_id and run_id=v_run)
    and i.item_type='transaction' and i.item_id=t.id;

  update public.financial_reconciliation_case_items i
  set metadata=jsonb_strip_nulls(jsonb_build_object(
    'party',r.customer_name,'description',r.description,'amount',r.amount,'settled_amount',r.received_amount,
    'settled_date',r.received_at::date,'due_date',r.due_date,'status',r.status,
    'document_number',l.payload->>'Número documento','history',l.payload->>'Histórico'
  ))
  from public.financial_receivables r
  left join public.legacy_import_records l
    on l.tenant_id=r.tenant_id and l.entity_type='accounts_receivable' and l.migrated_id=r.id
  where i.case_id in (select id from public.financial_reconciliation_cases where tenant_id=p_tenant_id and run_id=v_run)
    and i.item_type='receivable' and i.item_id=r.id;

  update public.financial_reconciliation_case_items i
  set metadata=jsonb_strip_nulls(jsonb_build_object(
    'party',e.supplier_name,'description',e.description,'amount',e.amount,'settled_amount',e.paid_amount,
    'settled_date',e.paid_at::date,'due_date',e.due_date,'status',e.status,
    'document_number',l.payload->>'Número documento','history',l.payload->>'Histórico'
  ))
  from public.expenses e
  left join public.legacy_import_records l
    on l.tenant_id=e.tenant_id and l.entity_type='accounts_payable' and l.migrated_id=e.id
  where i.case_id in (select id from public.financial_reconciliation_cases where tenant_id=p_tenant_id and run_id=v_run)
    and i.item_type='payable' and i.item_id=e.id;

  if p_auto_apply then
    for v_case in
      select id
      from public.financial_reconciliation_cases
      where tenant_id=p_tenant_id and run_id=v_run and status='suggested' and auto_eligible
      order by confidence desc,created_at,id
    loop
      perform private.apply_financial_reconciliation_case(v_case.id,v_user,'auto_applied');
      v_auto_count:=v_auto_count+1;
    end loop;
  end if;

  select jsonb_build_object(
    'pending',count(*) filter(where reconciliation_status='pending'),
    'partial',count(*) filter(where reconciliation_status='partial'),
    'matched',count(*) filter(where reconciliation_status='matched')
  ) into v_after
  from public.financial_transactions
  where tenant_id=p_tenant_id and source_type='bling_cash_banks';

  select count(*) into v_created_cases
  from public.financial_reconciliation_cases where tenant_id=p_tenant_id and run_id=v_run;

  select jsonb_build_object(
    'run_cases',v_created_cases,
    'auto_applied_cases',v_auto_count,
    'by_type_status',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.case_type,x.status)
      from (
        select case_type,status,count(*)::bigint count,round(coalesce(sum(total_cash),0)::numeric,2) total_cash
        from public.financial_reconciliation_cases
        where tenant_id=p_tenant_id and run_id=v_run
        group by case_type,status
      ) x
    ),'[]'::jsonb)
  ) into v_metrics;

  update public.financial_reconciliation_runs
  set status='completed',after_counts=v_after,metrics=v_metrics,finished_at=now()
  where id=v_run;

  select organization_id into v_org from public.tenants where id=p_tenant_id;
  if v_org is not null then
    insert into public.audit_events
      (organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data,metadata)
    values
      (v_org,p_tenant_id,v_user,'financial.smart_reconciliation_run','financial_reconciliation_run',v_run::text,
       jsonb_build_object('before',v_before,'after',v_after,'metrics',v_metrics),
       jsonb_build_object('auto_apply',p_auto_apply));
  end if;

  return jsonb_build_object('ok',true,'run_id',v_run,'before',v_before,'after',v_after,'metrics',v_metrics);
end;
$$;

revoke all on function public.run_smart_financial_reconciliation(uuid,boolean) from public,anon;
revoke all on function public.financial_reconciliation_queue_summary(uuid) from public,anon;
revoke all on function public.approve_financial_reconciliation_case(uuid,text) from public,anon;
revoke all on function public.reject_financial_reconciliation_case(uuid,text) from public,anon;
revoke all on function public.reverse_financial_reconciliation_case(uuid,text) from public,anon;
grant execute on function public.run_smart_financial_reconciliation(uuid,boolean) to authenticated,service_role;
grant execute on function public.financial_reconciliation_queue_summary(uuid) to authenticated,service_role;
grant execute on function public.approve_financial_reconciliation_case(uuid,text) to authenticated,service_role;
grant execute on function public.reject_financial_reconciliation_case(uuid,text) to authenticated,service_role;
grant execute on function public.reverse_financial_reconciliation_case(uuid,text) to authenticated,service_role;

commit;
