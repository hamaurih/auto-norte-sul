-- Corrige semântica de deleção em FKs compostas multiempresa.
-- Canais/categorias/centros são desativados logicamente; não limpamos tenant_id por cascata.

alter table public.tenant_pricing_settings
  drop constraint if exists tenant_pricing_settings_default_sales_channel_fk;
alter table public.tenant_pricing_settings
  add constraint tenant_pricing_settings_default_sales_channel_fk
  foreign key (default_sales_channel_id,tenant_id)
  references public.sales_channels(id,tenant_id);

alter table public.expenses
  drop constraint if exists expenses_category_id_tenant_id_fkey;
alter table public.expenses
  drop constraint if exists expenses_cost_center_id_tenant_id_fkey;

-- Nomes de constraint podem variar quando criados sem nome explícito.
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid='public.expenses'::regclass
      and contype='f'
      and confrelid in ('public.expense_categories'::regclass,'public.cost_centers'::regclass)
  loop
    execute format('alter table public.expenses drop constraint %I',r.conname);
  end loop;
end $$;

alter table public.expenses
  add constraint expenses_category_tenant_fk
  foreign key (category_id,tenant_id)
  references public.expense_categories(id,tenant_id);
alter table public.expenses
  add constraint expenses_cost_center_tenant_fk
  foreign key (cost_center_id,tenant_id)
  references public.cost_centers(id,tenant_id);

alter table public.product_profitability_rules
  drop constraint if exists product_profitability_rules_preferred_channel_id_tenant_id_fkey;
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid='public.product_profitability_rules'::regclass
      and contype='f'
      and confrelid='public.sales_channels'::regclass
  loop
    execute format('alter table public.product_profitability_rules drop constraint %I',r.conname);
  end loop;
end $$;
alter table public.product_profitability_rules
  add constraint product_profitability_rules_channel_tenant_fk
  foreign key (preferred_channel_id,tenant_id)
  references public.sales_channels(id,tenant_id);

alter table public.orders
  drop constraint if exists orders_sales_channel_tenant_fk;
alter table public.orders
  add constraint orders_sales_channel_tenant_fk
  foreign key (sales_channel_id,tenant_id)
  references public.sales_channels(id,tenant_id);
