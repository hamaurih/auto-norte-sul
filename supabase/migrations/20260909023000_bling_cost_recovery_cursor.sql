begin;

alter table public.bling_config
  add column if not exists last_cost_sync_page integer not null default 1,
  add column if not exists last_cost_sync_at timestamptz,
  add column if not exists last_cost_sync_status text,
  add column if not exists last_cost_sync_message text,
  add column if not exists last_cost_sync_cycle_token uuid;

alter table public.bling_config
  drop constraint if exists bling_config_last_cost_sync_page_check;
alter table public.bling_config
  add constraint bling_config_last_cost_sync_page_check
  check (last_cost_sync_page >= 1);

-- Custo zero no legado significa "desconhecido", não mercadoria grátis.
-- Não alteramos updated_at para evitar disparar sincronizações de catálogo em massa.
update public.products
set average_cost = nullif(average_cost, 0),
    last_purchase_cost = nullif(last_purchase_cost, 0)
where average_cost = 0
   or last_purchase_cost = 0;

comment on column public.bling_config.last_cost_sync_page is
  'Cursor da recuperação auditável de custos via GET /produtos/fornecedores do Bling.';
comment on column public.bling_config.last_cost_sync_at is
  'Última execução da recuperação de custos do Bling.';
comment on column public.bling_config.last_cost_sync_status is
  'Status resumido da última recuperação de custos do Bling.';
comment on column public.bling_config.last_cost_sync_message is
  'Mensagem resumida da última recuperação de custos do Bling.';
comment on column public.bling_config.last_cost_sync_cycle_token is
  'Identifica o ciclo atual para acumular fornecedores entre páginas sem carregar evidência obsoleta de ciclos anteriores.';

commit;
