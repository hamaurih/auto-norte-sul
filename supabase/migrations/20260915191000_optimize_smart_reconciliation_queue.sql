begin;

do $$
declare
  v_def text;
  v_start integer;
  v_end integer;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='run_smart_financial_reconciliation'
  limit 1;

  if v_def is null then raise exception 'run_smart_financial_reconciliation não encontrada'; end if;

  v_start := position('-- Anything still unresolved becomes a manual queue item, not an automatic guess.' in v_def);
  v_end := position('-- Enrich queue evidence without exposing raw payloads to the frontend.' in v_def);

  if v_start=0 or v_end=0 or v_end<=v_start then
    raise exception 'Bloco de fila não resolvida não encontrado para otimização';
  end if;

  v_def := substring(v_def from 1 for v_start-1)
    || '-- Unresolved transactions are served dynamically by financial_reconciliation_unmatched_queue to avoid materializing tens of thousands of low-information cases.' || E'\n  '
    || substring(v_def from v_end);

  execute v_def;
end;
$$;

create or replace function public.financial_reconciliation_unmatched_queue(
  p_tenant_id uuid,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_total bigint;
  v_rows jsonb;
begin
  if v_user is not null and not private.has_tenant_role(p_tenant_id,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão financeira';
  end if;

  p_limit:=greatest(1,least(coalesce(p_limit,200),500));
  p_offset:=greatest(0,coalesce(p_offset,0));

  select count(*) into v_total
  from public.financial_transactions t
  where t.tenant_id=p_tenant_id
    and t.source_type='bling_cash_banks'
    and t.reconciliation_status='pending'
    and not exists (
      select 1
      from public.financial_reconciliation_case_items i
      join public.financial_reconciliation_cases c on c.id=i.case_id
      where i.tenant_id=p_tenant_id
        and i.item_type='transaction'
        and i.item_id=t.id
        and c.status in ('suggested','auto_applied','approved')
        and c.case_type<>'unmatched'
    );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.transaction_date desc,x.id),'[]'::jsonb)
    into v_rows
  from (
    select t.id,t.transaction_date,t.direction,t.amount,t.description,t.external_reference,t.reconciliation_status,
           l.payload->>'Cliente' as party,
           l.payload->>'Histórico' as history,
           l.payload->>'Categoria' as category,
           'Nenhuma relação determinística e única foi comprovada'::text as reason
    from public.financial_transactions t
    left join public.legacy_import_records l
      on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
    where t.tenant_id=p_tenant_id
      and t.source_type='bling_cash_banks'
      and t.reconciliation_status='pending'
      and not exists (
        select 1
        from public.financial_reconciliation_case_items i
        join public.financial_reconciliation_cases c on c.id=i.case_id
        where i.tenant_id=p_tenant_id
          and i.item_type='transaction'
          and i.item_id=t.id
          and c.status in ('suggested','auto_applied','approved')
          and c.case_type<>'unmatched'
      )
    order by t.transaction_date desc,t.id
    limit p_limit offset p_offset
  ) x;

  return jsonb_build_object('total',v_total,'limit',p_limit,'offset',p_offset,'rows',v_rows);
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
  v_unresolved bigint;
begin
  if v_user is not null and not private.has_tenant_role(p_tenant_id,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão financeira';
  end if;

  select jsonb_build_object(
    'pending',count(*) filter(where reconciliation_status='pending'),
    'partial',count(*) filter(where reconciliation_status='partial'),
    'matched',count(*) filter(where reconciliation_status='matched'),
    'ignored',count(*) filter(where reconciliation_status='ignored')
  ) into v_result
  from public.financial_transactions
  where tenant_id=p_tenant_id and source_type='bling_cash_banks';

  select count(*) into v_unresolved
  from public.financial_transactions t
  where t.tenant_id=p_tenant_id
    and t.source_type='bling_cash_banks'
    and t.reconciliation_status='pending'
    and not exists (
      select 1
      from public.financial_reconciliation_case_items i
      join public.financial_reconciliation_cases c on c.id=i.case_id
      where i.tenant_id=p_tenant_id
        and i.item_type='transaction'
        and i.item_id=t.id
        and c.status in ('suggested','auto_applied','approved')
        and c.case_type<>'unmatched'
    );

  v_result:=jsonb_build_object('transactions',v_result,'unresolved',v_unresolved)
    ||jsonb_build_object(
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
      'transfers',(
        select jsonb_build_object('count',count(*)::bigint,'total',round(coalesce(sum(amount),0)::numeric,2))
        from public.financial_internal_transfers
        where tenant_id=p_tenant_id and status='active'
      ),
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

revoke all on function public.financial_reconciliation_unmatched_queue(uuid,integer,integer) from public,anon;
grant execute on function public.financial_reconciliation_unmatched_queue(uuid,integer,integer) to authenticated,service_role;

commit;
