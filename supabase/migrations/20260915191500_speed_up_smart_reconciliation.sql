begin;

create index if not exists legacy_import_records_reconciliation_idx
  on public.legacy_import_records(tenant_id,entity_type,migrated_id)
  where migrated_id is not null;

create index if not exists financial_receivables_bling_reconciliation_idx
  on public.financial_receivables(tenant_id,status,received_at,amount)
  where source_type='bling_backup';

create index if not exists expenses_bling_reconciliation_idx
  on public.expenses(tenant_id,status,paid_at,amount)
  where source_type='bling_backup';

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

  v_start := position('-- Enrich queue evidence without exposing raw payloads to the frontend.' in v_def);
  v_end := position('if p_auto_apply then' in v_def);

  if v_start=0 or v_end=0 or v_end<=v_start then
    raise exception 'Bloco de enriquecimento não encontrado para otimização';
  end if;

  v_def := substring(v_def from 1 for v_start-1)
    || '-- Case detail metadata is loaded on demand by dedicated queue RPCs.' || E'\n  '
    || substring(v_def from v_end);

  execute v_def;
end;
$$;

create or replace function public.financial_reconciliation_case_details(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_case public.financial_reconciliation_cases;
  v_items jsonb;
begin
  select * into v_case from public.financial_reconciliation_cases where id=p_case_id;
  if v_case.id is null then raise exception 'Caso não encontrado'; end if;

  if v_user is not null and not private.has_tenant_role(v_case.tenant_id,array['owner','admin','manager','finance']::text[]) then
    raise exception 'Usuário sem permissão financeira';
  end if;

  select coalesce(jsonb_agg(item order by item->>'item_type',item->>'role'),'[]'::jsonb)
    into v_items
  from (
    select jsonb_strip_nulls(jsonb_build_object(
      'id',i.id,
      'item_type',i.item_type,
      'item_id',i.item_id,
      'amount',i.amount,
      'role',i.role,
      'metadata',
        case
          when i.item_type='transaction' then (
            select jsonb_strip_nulls(jsonb_build_object(
              'date',t.transaction_date,
              'direction',t.direction,
              'description',t.description,
              'amount',t.amount,
              'external_reference',t.external_reference,
              'reconciliation_status',t.reconciliation_status,
              'party',l.payload->>'Cliente',
              'history',l.payload->>'Histórico',
              'category',l.payload->>'Categoria'
            ))
            from public.financial_transactions t
            left join public.legacy_import_records l
              on l.tenant_id=t.tenant_id and l.entity_type='cash_banks' and l.migrated_id=t.id
            where t.id=i.item_id
          )
          when i.item_type='receivable' then (
            select jsonb_strip_nulls(jsonb_build_object(
              'party',r.customer_name,
              'description',r.description,
              'amount',r.amount,
              'settled_amount',r.received_amount,
              'settled_date',r.received_at::date,
              'due_date',r.due_date,
              'status',r.status,
              'document_number',l.payload->>'Número documento',
              'history',l.payload->>'Histórico'
            ))
            from public.financial_receivables r
            left join public.legacy_import_records l
              on l.tenant_id=r.tenant_id and l.entity_type='accounts_receivable' and l.migrated_id=r.id
            where r.id=i.item_id
          )
          when i.item_type='payable' then (
            select jsonb_strip_nulls(jsonb_build_object(
              'party',e.supplier_name,
              'description',e.description,
              'amount',e.amount,
              'settled_amount',e.paid_amount,
              'settled_date',e.paid_at::date,
              'due_date',e.due_date,
              'status',e.status,
              'document_number',l.payload->>'Número documento',
              'history',l.payload->>'Histórico'
            ))
            from public.expenses e
            left join public.legacy_import_records l
              on l.tenant_id=e.tenant_id and l.entity_type='accounts_payable' and l.migrated_id=e.id
            where e.id=i.item_id
          )
        end
    )) item
    from public.financial_reconciliation_case_items i
    where i.case_id=v_case.id
  ) q;

  return jsonb_build_object(
    'case',to_jsonb(v_case),
    'items',v_items,
    'adjustment',(
      select to_jsonb(a) from public.financial_adjustments a where a.case_id=v_case.id limit 1
    ),
    'transfer',(
      select to_jsonb(x) from public.financial_internal_transfers x where x.case_id=v_case.id limit 1
    )
  );
end;
$$;

revoke all on function public.financial_reconciliation_case_details(uuid) from public,anon;
grant execute on function public.financial_reconciliation_case_details(uuid) to authenticated,service_role;

commit;
