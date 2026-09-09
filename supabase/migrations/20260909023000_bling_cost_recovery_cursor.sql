begin;

alter table public.bling_config
  add column if not exists last_cost_sync_page integer not null default 1,
  add column if not exists last_cost_sync_at timestamptz,
  add column if not exists last_cost_sync_status text,
  add column if not exists last_cost_sync_message text;

alter table public.bling_config
  drop constraint if exists bling_config_last_cost_sync_page_check;
alter table public.bling_config
  add constraint bling_config_last_cost_sync_page_check
  check (last_cost_sync_page >= 1);

-- Custo zero significa custo desconhecido no ERP. Normalizamos para NULL para
-- impedir que margem/rentabilidade trate ausência de custo como custo real zero.
update public.products
set average_cost = null,
    updated_at = now()
where average_cost = 0;

update public.products
set last_purchase_cost = null,
    updated_at = now()
where last_purchase_cost = 0;

comment on column public.bling_config.last_cost_sync_page is
  'Cursor da recuperação auditável de custos via GET /produtos/fornecedores do Bling.';
comment on column public.bling_config.last_cost_sync_at is
  'Última execução da recuperação de custos do Bling.';
comment on column public.bling_config.last_cost_sync_status is
  'Status resumido da última recuperação de custos do Bling.';
comment on column public.bling_config.last_cost_sync_message is
  'Mensagem resumida da última recuperação de custos do Bling.';

commit;
