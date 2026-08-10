-- PDV · endurecimento de segurança e índices (idempotente)
--
-- Contexto: as funções do PDV (open_pos_cash_session, close_pos_cash_session,
-- record_pos_cash_movement, finalize_pos_sale, cancel_pos_sale) são
-- SECURITY DEFINER e precisam permanecer em `public` porque são chamadas via
-- RPC do PostgREST pelas server functions da aplicação. Este script:
--   1. fixa `search_path` de cada função (evita sequestro de resolução);
--   2. revoga EXECUTE de PUBLIC e anon;
--   3. concede EXECUTE apenas a authenticated (e service_role);
--   4. cria índices de consulta do histórico/relatório apenas se faltarem.
--
-- Não altera corpo de função, não altera dados e pode ser reexecutado.

set local statement_timeout = '60s';

do $$
declare
  fn record;
begin
  for fn in
    select p.oid,
           p.oid::regprocedure::text as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'open_pos_cash_session',
         'close_pos_cash_session',
         'record_pos_cash_movement',
         'finalize_pos_sale',
         'cancel_pos_sale'
       )
  loop
    -- search_path fixo e explícito
    execute format('alter function %s set search_path = public, pg_temp', fn.signature);

    -- mínimo privilégio: só usuário autenticado (RLS + validações internas) e service_role
    execute format('revoke all on function %s from public', fn.signature);
    execute format('revoke all on function %s from anon', fn.signature);
    execute format('grant execute on function %s to authenticated', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end
$$;

-- Índices do histórico e do relatório de caixa (idempotentes)
create index if not exists pos_sales_tenant_created_idx
  on public.pos_sales (tenant_id, created_at desc);

create index if not exists pos_sales_tenant_status_created_idx
  on public.pos_sales (tenant_id, status, created_at desc);

create index if not exists pos_sales_tenant_operator_created_idx
  on public.pos_sales (tenant_id, operator_id, created_at desc);

create index if not exists pos_sales_session_idx
  on public.pos_sales (cash_session_id);

create index if not exists pos_sales_customer_idx
  on public.pos_sales (tenant_id, customer_id);

create index if not exists pos_sale_items_sale_idx
  on public.pos_sale_items (sale_id);

create index if not exists pos_payments_sale_idx
  on public.pos_payments (sale_id);

create index if not exists pos_payments_tenant_method_idx
  on public.pos_payments (tenant_id, method);

create index if not exists pos_cash_sessions_tenant_opened_idx
  on public.pos_cash_sessions (tenant_id, opened_at desc);

create index if not exists pos_cash_sessions_tenant_terminal_idx
  on public.pos_cash_sessions (tenant_id, terminal_code, opened_at desc);

create index if not exists pos_cash_movements_session_idx
  on public.pos_cash_movements (cash_session_id);

-- Leitura do histórico/relatório é feita por server functions autenticadas;
-- anon nunca deve ler as tabelas do PDV.
revoke all on table public.pos_sales from anon;
revoke all on table public.pos_sale_items from anon;
revoke all on table public.pos_payments from anon;
revoke all on table public.pos_cash_sessions from anon;
revoke all on table public.pos_cash_movements from anon;
