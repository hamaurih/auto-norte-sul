begin;

create or replace function private.assert_financial_reconciliation_run(p_tenant_id uuid,p_run_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is not null and not private.has_tenant_role(p_tenant_id,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão financeira';
  end if;
  if not exists (
    select 1 from public.financial_reconciliation_runs
    where id=p_run_id and tenant_id=p_tenant_id and status='running'
  ) then
    raise exception 'Execução de conciliação inválida ou já encerrada';
  end if;
end;
$$;

create or replace function private.bling_pending_cash(p_tenant_id uuid)
returns table(
  id uuid,
  direction text,
  transaction_date date,
  amount numeric,
  external_reference text,
  description text,
  party text,
  history text,
  category text
)
language sql
stable
security definer
set search_path=''
as $$
  select t.id,t.direction,t.transaction_date,t.amount,t.external_reference,t.description,
         lower(btrim(coalesce(l.payload->>'Cliente',''))) as party,
         lower(btrim(coalesce(l.payload->>'Histórico',''))) as history,
         btrim(coalesce(l.payload->>'Categoria','')) as category
  from public.financial_transactions t
  left join public.legacy_import_records l
    on l.tenant_id=t.tenant_id
   and l.entity_type='cash_banks'
   and l.migrated_id=t.id
  where t.tenant_id=p_tenant_id
    and t.source_type='bling_cash_banks'
    and t.reconciliation_status='pending';
$$;

create or replace function private.bling_unmatched_titles(p_tenant_id uuid)
returns table(
  target_type text,
  target_id uuid,
  settled_date date,
  amount numeric,
  party text,
  history text
)
language sql
stable
security definer
set search_path=''
as $$
  select 'receivable'::text,r.id,r.received_at::date,r.amount::numeric,
         lower(btrim(coalesce(l.payload->>'Cliente',r.customer_name,''))),
         lower(btrim(coalesce(l.payload->>'Histórico','')))
  from public.financial_receivables r
  join public.legacy_import_records l
    on l.tenant_id=r.tenant_id
   and l.entity_type='accounts_receivable'
   and l.migrated_id=r.id
  where r.tenant_id=p_tenant_id
    and r.source_type='bling_backup'
    and r.status='received'
    and r.received_at is not null
    and not exists (
      select 1 from public.financial_reconciliation_matches m
      where m.tenant_id=p_tenant_id and m.target_type='receivable' and m.target_id=r.id
    )

  union all

  select 'payable',e.id,e.paid_at::date,e.amount::numeric,
         lower(btrim(coalesce(l.payload->>'Fornecedor',e.supplier_name,''))),
         lower(btrim(coalesce(l.payload->>'Histórico','')))
  from public.expenses e
  join public.legacy_import_records l
    on l.tenant_id=e.tenant_id
   and l.entity_type='accounts_payable'
   and l.migrated_id=e.id
  where e.tenant_id=p_tenant_id
    and e.source_type='bling_backup'
    and e.status='paid'
    and e.paid_at is not null
    and not exists (
      select 1 from public.financial_reconciliation_matches m
      where m.tenant_id=p_tenant_id and m.target_type='payable' and m.target_id=e.id
    );
$$;

create or replace function public.start_financial_reconciliation_run(p_tenant_id uuid,p_mode text default 'analysis')
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_run uuid:=gen_random_uuid();
  v_before jsonb;
begin
  if v_user is not null and not private.has_tenant_role(p_tenant_id,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão financeira';
  end if;
  if p_mode not in ('analysis','apply') then raise exception 'Modo inválido'; end if;

  select jsonb_build_object(
    'pending',count(*) filter(where reconciliation_status='pending'),
    'partial',count(*) filter(where reconciliation_status='partial'),
    'matched',count(*) filter(where reconciliation_status='matched')
  ) into v_before
  from public.financial_transactions
  where tenant_id=p_tenant_id and source_type='bling_cash_banks';

  insert into public.financial_reconciliation_runs(id,tenant_id,mode,status,before_counts,created_by)
  values(v_run,p_tenant_id,p_mode,'running',v_before,v_user);

  return jsonb_build_object('ok',true,'run_id',v_run,'before',v_before);
end;
$$;

create or replace function public.discover_financial_reconciliation_adjustments(p_tenant_id uuid,p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_cases bigint;
begin
  perform private.assert_financial_reconciliation_run(p_tenant_id,p_run_id);

  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,p_run_id,
    case when c.category='Taxas pagas' then 'fee'
         when c.category='Juros recebidos' then 'interest'
         else 'other_adjustment' end,
    'suggested',1,
    'explicit-adjustment:'||c.id::text,
    jsonb_build_object(
      'transaction_id',c.id,'transaction_date',c.transaction_date,'direction',c.direction,'category',c.category,
      'history',c.history,'party',c.party,'external_reference',c.external_reference,
      'adjustment_type',case when c.category='Taxas pagas' then 'bank_fee'
                             when c.category='Juros recebidos' then 'interest_income'
                             else 'other' end,
      'dre_effect',case when c.category in ('Juros recebidos','Acréscimos recebidos') then 'income' else 'expense' end,
      'reason','Categoria explícita do backup Bling'
    ),
    c.amount,0,c.amount,true,v_user
  from private.bling_pending_cash(p_tenant_id) c
  where c.category in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,
        auto_eligible=excluded.auto_eligible,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'transaction_id')::uuid,c.total_cash,'adjustment'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.fingerprint like 'explicit-adjustment:%'
  on conflict (case_id,item_type,item_id,role) do nothing;

  select count(*) into v_cases
  from public.financial_reconciliation_cases
  where tenant_id=p_tenant_id and run_id=p_run_id and fingerprint like 'explicit-adjustment:%';

  return jsonb_build_object('ok',true,'phase','adjustments','cases',v_cases);
end;
$$;

create or replace function public.discover_financial_reconciliation_one_to_one(p_tenant_id uuid,p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_cases bigint;
begin
  perform private.assert_financial_reconciliation_run(p_tenant_id,p_run_id);

  with cash as (
    select c.*
    from private.bling_pending_cash(p_tenant_id) c
    where c.category not in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
      and not exists (
        select 1
        from public.financial_reconciliation_case_items i
        join public.financial_reconciliation_cases rc on rc.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=c.id
          and rc.status in ('suggested','auto_applied','approved') and rc.case_type<>'unmatched'
      )
  ),
  titles as (
    select t.*
    from private.bling_unmatched_titles(p_tenant_id) t
    where not exists (
      select 1
      from public.financial_reconciliation_case_items i
      join public.financial_reconciliation_cases rc on rc.id=i.case_id
      where i.tenant_id=p_tenant_id and i.item_type=t.target_type and i.item_id=t.target_id
        and rc.status in ('suggested','auto_applied','approved') and rc.case_type<>'unmatched'
    )
  ),
  candidates as (
    select c.id transaction_id,c.amount cash_amount,c.transaction_date,
           c.party cash_party,c.history cash_history,
           t.target_type,t.target_id,t.amount title_amount,t.party target_party,t.history target_history,
           count(*) over(partition by c.id) tx_candidates,
           count(*) over(partition by t.target_type,t.target_id) target_candidates
    from cash c
    join titles t
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
  select p_tenant_id,p_run_id,'one_to_one','suggested',1,
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
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type='one_to_one'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,c.evidence->>'target_type',(c.evidence->>'target_id')::uuid,c.total_titles,'title'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type='one_to_one'
  on conflict (case_id,item_type,item_id,role) do nothing;

  select count(*) into v_cases
  from public.financial_reconciliation_cases
  where tenant_id=p_tenant_id and run_id=p_run_id and case_type='one_to_one';

  return jsonb_build_object('ok',true,'phase','one_to_one','cases',v_cases);
end;
$$;

create or replace function public.discover_financial_reconciliation_one_to_many(p_tenant_id uuid,p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_cases bigint;
begin
  perform private.assert_financial_reconciliation_run(p_tenant_id,p_run_id);

  with cash_pool as (
    select c.*
    from private.bling_pending_cash(p_tenant_id) c
    where c.category not in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
      and not exists (
        select 1 from public.financial_reconciliation_case_items i
        join public.financial_reconciliation_cases rc on rc.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=c.id
          and rc.status in ('suggested','auto_applied','approved') and rc.case_type<>'unmatched'
      )
  ),
  title_pool as (
    select t.*
    from private.bling_unmatched_titles(p_tenant_id) t
    where not exists (
      select 1 from public.financial_reconciliation_case_items i
      join public.financial_reconciliation_cases rc on rc.id=i.case_id
      where i.tenant_id=p_tenant_id and i.item_type=t.target_type and i.item_id=t.target_id
        and rc.status in ('suggested','auto_applied','approved') and rc.case_type<>'unmatched'
    )
  ),
  cg as (
    select direction,transaction_date,party,count(*) tx_count,sum(amount) tx_sum,
           (array_agg(id order by id::text))[1] only_tx
    from cash_pool
    where party<>''
    group by direction,transaction_date,party
  ),
  tg as (
    select target_type,settled_date,party,count(*) title_count,sum(amount) title_sum,
           array_agg(target_id order by target_id::text) target_ids
    from title_pool
    where party<>''
    group by target_type,settled_date,party
  ),
  safe as (
    select cg.*,tg.target_type,tg.title_count,tg.title_sum,tg.target_ids
    from cg
    join tg on tg.settled_date=cg.transaction_date and tg.party=cg.party
      and ((cg.direction='in' and tg.target_type='receivable') or (cg.direction='out' and tg.target_type='payable'))
    where cg.tx_count=1 and tg.title_count between 2 and 6 and abs(cg.tx_sum-tg.title_sum)<0.009
  )
  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,p_run_id,'one_to_many','suggested',1,
    'one-to-many:'||only_tx::text||':'||md5(array_to_string(target_ids,',')),
    jsonb_build_object(
      'transaction_id',only_tx,'target_type',target_type,'target_ids',to_jsonb(target_ids),
      'transaction_date',transaction_date,'party',party,
      'reason','Um movimento e todos os títulos do favorecido/data fecham exatamente'
    ),
    tx_sum,title_sum,tx_sum-title_sum,true,v_user
  from safe
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,
        auto_eligible=excluded.auto_eligible,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'transaction_id')::uuid,c.total_cash,'cash'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type='one_to_many'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,c.evidence->>'target_type',j.value::uuid,
         case when c.evidence->>'target_type'='receivable' then r.amount else e.amount end,'title'
  from public.financial_reconciliation_cases c
  cross join lateral jsonb_array_elements_text(c.evidence->'target_ids') j(value)
  left join public.financial_receivables r
    on c.evidence->>'target_type'='receivable' and r.id=j.value::uuid
  left join public.expenses e
    on c.evidence->>'target_type'='payable' and e.id=j.value::uuid
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type='one_to_many'
  on conflict (case_id,item_type,item_id,role) do nothing;

  select count(*) into v_cases
  from public.financial_reconciliation_cases
  where tenant_id=p_tenant_id and run_id=p_run_id and case_type='one_to_many';

  return jsonb_build_object('ok',true,'phase','one_to_many','cases',v_cases);
end;
$$;

create or replace function public.discover_financial_reconciliation_many_to_one(p_tenant_id uuid,p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_cases bigint;
begin
  perform private.assert_financial_reconciliation_run(p_tenant_id,p_run_id);

  with cash_pool as (
    select c.*
    from private.bling_pending_cash(p_tenant_id) c
    where c.category not in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
      and not exists (
        select 1 from public.financial_reconciliation_case_items i
        join public.financial_reconciliation_cases rc on rc.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=c.id
          and rc.status in ('suggested','auto_applied','approved') and rc.case_type<>'unmatched'
      )
  ),
  title_pool as (
    select t.*
    from private.bling_unmatched_titles(p_tenant_id) t
    where not exists (
      select 1 from public.financial_reconciliation_case_items i
      join public.financial_reconciliation_cases rc on rc.id=i.case_id
      where i.tenant_id=p_tenant_id and i.item_type=t.target_type and i.item_id=t.target_id
        and rc.status in ('suggested','auto_applied','approved') and rc.case_type<>'unmatched'
    )
  ),
  cg as (
    select direction,transaction_date,party,count(*) tx_count,sum(amount) tx_sum,
           array_agg(id order by id::text) tx_ids
    from cash_pool
    where party<>''
    group by direction,transaction_date,party
  ),
  tg as (
    select target_type,settled_date,party,count(*) title_count,sum(amount) title_sum,
           (array_agg(target_id order by target_id::text))[1] only_target
    from title_pool
    where party<>''
    group by target_type,settled_date,party
  ),
  safe as (
    select cg.*,tg.target_type,tg.only_target,tg.title_sum
    from cg
    join tg on tg.settled_date=cg.transaction_date and tg.party=cg.party
      and ((cg.direction='in' and tg.target_type='receivable') or (cg.direction='out' and tg.target_type='payable'))
    where cg.tx_count between 2 and 6 and tg.title_count=1 and abs(cg.tx_sum-tg.title_sum)<0.009
  )
  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,p_run_id,'many_to_one','suggested',1,
    'many-to-one:'||target_type||':'||only_target::text||':'||md5(array_to_string(tx_ids,',')),
    jsonb_build_object(
      'transaction_ids',to_jsonb(tx_ids),'target_type',target_type,'target_id',only_target,
      'transaction_date',transaction_date,'party',party,
      'reason','Todos os movimentos do favorecido/data fecham exatamente um único título'
    ),
    tx_sum,title_sum,tx_sum-title_sum,true,v_user
  from safe
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,
        auto_eligible=excluded.auto_eligible,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',j.value::uuid,t.amount,'cash'
  from public.financial_reconciliation_cases c
  cross join lateral jsonb_array_elements_text(c.evidence->'transaction_ids') j(value)
  join public.financial_transactions t on t.id=j.value::uuid
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type='many_to_one'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,c.evidence->>'target_type',(c.evidence->>'target_id')::uuid,c.total_titles,'title'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type='many_to_one'
  on conflict (case_id,item_type,item_id,role) do nothing;

  select count(*) into v_cases
  from public.financial_reconciliation_cases
  where tenant_id=p_tenant_id and run_id=p_run_id and case_type='many_to_one';

  return jsonb_build_object('ok',true,'phase','many_to_one','cases',v_cases);
end;
$$;

create or replace function public.discover_financial_reconciliation_differences(p_tenant_id uuid,p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_cases bigint;
begin
  perform private.assert_financial_reconciliation_run(p_tenant_id,p_run_id);

  with cash as (
    select c.*
    from private.bling_pending_cash(p_tenant_id) c
    where c.category not in ('Taxas pagas','Juros recebidos','Acréscimos recebidos','Acréscimos pagos')
      and not exists (
        select 1 from public.financial_reconciliation_case_items i
        join public.financial_reconciliation_cases rc on rc.id=i.case_id
        where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=c.id
          and rc.status in ('suggested','auto_applied','approved') and rc.case_type<>'unmatched'
      )
  ),
  titles as (
    select t.*
    from private.bling_unmatched_titles(p_tenant_id) t
    where not exists (
      select 1 from public.financial_reconciliation_case_items i
      join public.financial_reconciliation_cases rc on rc.id=i.case_id
      where i.tenant_id=p_tenant_id and i.item_type=t.target_type and i.item_id=t.target_id
        and rc.status in ('suggested','auto_applied','approved') and rc.case_type<>'unmatched'
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
    from cash c
    join titles t
      on t.settled_date=c.transaction_date
     and ((c.direction='in' and t.target_type='receivable') or (c.direction='out' and t.target_type='payable'))
     and ((c.party<>'' and c.party=t.party) or (c.history<>'' and c.history=t.history))
     and abs(c.amount-t.amount)>=0.009
  ),
  safe as (
    select * from raw where detected_type is not null and tx_candidates=1 and target_candidates=1
  )
  insert into public.financial_reconciliation_cases
    (tenant_id,run_id,case_type,status,confidence,fingerprint,evidence,total_cash,total_titles,difference,auto_eligible,created_by)
  select p_tenant_id,p_run_id,detected_type,'suggested',1,
    detected_type||'-difference:'||id::text||':'||target_type||':'||target_id::text,
    jsonb_build_object(
      'transaction_id',id,'target_type',target_type,'target_id',target_id,'transaction_date',transaction_date,
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
      'reason','Natureza da diferença aparece explicitamente no histórico e o par é único'
    ),
    amount,title_amount,amount-title_amount,true,v_user
  from safe
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,
        auto_eligible=excluded.auto_eligible,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'transaction_id')::uuid,c.total_cash,'cash'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type in ('interest','discount')
    and c.evidence ? 'target_id'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,c.evidence->>'target_type',(c.evidence->>'target_id')::uuid,c.total_titles,'title'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type in ('interest','discount')
    and c.evidence ? 'target_id'
  on conflict (case_id,item_type,item_id,role) do nothing;

  select count(*) into v_cases
  from public.financial_reconciliation_cases
  where tenant_id=p_tenant_id and run_id=p_run_id and case_type in ('interest','discount')
    and evidence ? 'target_id';

  return jsonb_build_object('ok',true,'phase','differences','cases',v_cases);
end;
$$;

create or replace function public.discover_financial_reconciliation_transfers(p_tenant_id uuid,p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_cases bigint;
begin
  perform private.assert_financial_reconciliation_run(p_tenant_id,p_run_id);

  with cash as (
    select c.*,t.account_id
    from private.bling_pending_cash(p_tenant_id) c
    join public.financial_transactions t on t.id=c.id
    where not exists (
      select 1 from public.financial_reconciliation_case_items i
      join public.financial_reconciliation_cases rc on rc.id=i.case_id
      where i.tenant_id=p_tenant_id and i.item_type='transaction' and i.item_id=c.id
        and rc.status in ('suggested','auto_applied','approved') and rc.case_type<>'unmatched'
    )
  ),
  pairs as (
    select o.id out_id,i.id in_id,o.amount,o.transaction_date,o.history out_history,i.history in_history,
      count(*) over(partition by o.id) out_candidates,
      count(*) over(partition by i.id) in_candidates
    from cash o
    join cash i
      on o.direction='out' and i.direction='in'
     and o.transaction_date=i.transaction_date
     and abs(o.amount-i.amount)<0.009
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
  select p_tenant_id,p_run_id,'internal_transfer','suggested',0.85,
    'internal-transfer:'||out_id::text||':'||in_id::text,
    jsonb_build_object(
      'out_transaction_id',out_id,'in_transaction_id',in_id,'transaction_date',transaction_date,
      'out_history',out_history,'in_history',in_history,'account_mapping_required',true,
      'reason','Par entrada/saída único por data e valor com indicação textual de transferência; contas históricas ainda colapsadas'
    ),
    amount,amount,0,false,v_user
  from safe
  on conflict (tenant_id,fingerprint) do update
    set run_id=excluded.run_id,evidence=excluded.evidence,confidence=excluded.confidence,
        auto_eligible=false,updated_at=now()
  where public.financial_reconciliation_cases.status='suggested';

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'out_transaction_id')::uuid,c.total_cash,'source'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type='internal_transfer'
  on conflict (case_id,item_type,item_id,role) do nothing;

  insert into public.financial_reconciliation_case_items(tenant_id,case_id,item_type,item_id,amount,role)
  select c.tenant_id,c.id,'transaction',(c.evidence->>'in_transaction_id')::uuid,c.total_cash,'destination'
  from public.financial_reconciliation_cases c
  where c.tenant_id=p_tenant_id and c.run_id=p_run_id and c.case_type='internal_transfer'
  on conflict (case_id,item_type,item_id,role) do nothing;

  select count(*) into v_cases
  from public.financial_reconciliation_cases
  where tenant_id=p_tenant_id and run_id=p_run_id and case_type='internal_transfer';

  return jsonb_build_object('ok',true,'phase','transfers','cases',v_cases);
end;
$$;

create or replace function public.apply_financial_reconciliation_auto_batch(
  p_tenant_id uuid,
  p_run_id uuid,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_case record;
  v_applied integer:=0;
  v_remaining bigint;
begin
  perform private.assert_financial_reconciliation_run(p_tenant_id,p_run_id);
  p_limit:=greatest(1,least(coalesce(p_limit,200),500));

  for v_case in
    select id
    from public.financial_reconciliation_cases
    where tenant_id=p_tenant_id and run_id=p_run_id and status='suggested' and auto_eligible
    order by confidence desc,created_at,id
    limit p_limit
  loop
    perform private.apply_financial_reconciliation_case(v_case.id,v_user,'auto_applied');
    v_applied:=v_applied+1;
  end loop;

  select count(*) into v_remaining
  from public.financial_reconciliation_cases
  where tenant_id=p_tenant_id and run_id=p_run_id and status='suggested' and auto_eligible;

  return jsonb_build_object('ok',true,'applied',v_applied,'remaining',v_remaining);
end;
$$;

create or replace function public.finish_financial_reconciliation_run(p_tenant_id uuid,p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_before jsonb;
  v_after jsonb;
  v_metrics jsonb;
  v_org uuid;
begin
  perform private.assert_financial_reconciliation_run(p_tenant_id,p_run_id);

  select before_counts into v_before
  from public.financial_reconciliation_runs
  where id=p_run_id and tenant_id=p_tenant_id;

  select jsonb_build_object(
    'pending',count(*) filter(where reconciliation_status='pending'),
    'partial',count(*) filter(where reconciliation_status='partial'),
    'matched',count(*) filter(where reconciliation_status='matched')
  ) into v_after
  from public.financial_transactions
  where tenant_id=p_tenant_id and source_type='bling_cash_banks';

  select jsonb_build_object(
    'run_cases',count(*)::bigint,
    'auto_applied_cases',count(*) filter(where status='auto_applied')::bigint,
    'suggested_cases',count(*) filter(where status='suggested')::bigint,
    'by_type_status',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.case_type,x.status)
      from (
        select case_type,status,count(*)::bigint count,round(coalesce(sum(total_cash),0)::numeric,2) total_cash
        from public.financial_reconciliation_cases
        where tenant_id=p_tenant_id and run_id=p_run_id
        group by case_type,status
      ) x
    ),'[]'::jsonb)
  ) into v_metrics
  from public.financial_reconciliation_cases
  where tenant_id=p_tenant_id and run_id=p_run_id;

  update public.financial_reconciliation_runs
  set status='completed',after_counts=v_after,metrics=v_metrics,finished_at=now()
  where id=p_run_id and tenant_id=p_tenant_id;

  select organization_id into v_org from public.tenants where id=p_tenant_id;
  if v_org is not null then
    insert into public.audit_events
      (organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data,metadata)
    values
      (v_org,p_tenant_id,v_user,'financial.smart_reconciliation_run','financial_reconciliation_run',p_run_id::text,
       jsonb_build_object('before',v_before,'after',v_after,'metrics',v_metrics),'{}'::jsonb);
  end if;

  return jsonb_build_object('ok',true,'run_id',p_run_id,'before',v_before,'after',v_after,'metrics',v_metrics);
end;
$$;

revoke all on function public.start_financial_reconciliation_run(uuid,text) from public,anon;
revoke all on function public.discover_financial_reconciliation_adjustments(uuid,uuid) from public,anon;
revoke all on function public.discover_financial_reconciliation_one_to_one(uuid,uuid) from public,anon;
revoke all on function public.discover_financial_reconciliation_one_to_many(uuid,uuid) from public,anon;
revoke all on function public.discover_financial_reconciliation_many_to_one(uuid,uuid) from public,anon;
revoke all on function public.discover_financial_reconciliation_differences(uuid,uuid) from public,anon;
revoke all on function public.discover_financial_reconciliation_transfers(uuid,uuid) from public,anon;
revoke all on function public.apply_financial_reconciliation_auto_batch(uuid,uuid,integer) from public,anon;
revoke all on function public.finish_financial_reconciliation_run(uuid,uuid) from public,anon;

grant execute on function public.start_financial_reconciliation_run(uuid,text) to authenticated,service_role;
grant execute on function public.discover_financial_reconciliation_adjustments(uuid,uuid) to authenticated,service_role;
grant execute on function public.discover_financial_reconciliation_one_to_one(uuid,uuid) to authenticated,service_role;
grant execute on function public.discover_financial_reconciliation_one_to_many(uuid,uuid) to authenticated,service_role;
grant execute on function public.discover_financial_reconciliation_many_to_one(uuid,uuid) to authenticated,service_role;
grant execute on function public.discover_financial_reconciliation_differences(uuid,uuid) to authenticated,service_role;
grant execute on function public.discover_financial_reconciliation_transfers(uuid,uuid) to authenticated,service_role;
grant execute on function public.apply_financial_reconciliation_auto_batch(uuid,uuid,integer) to authenticated,service_role;
grant execute on function public.finish_financial_reconciliation_run(uuid,uuid) to authenticated,service_role;

commit;
