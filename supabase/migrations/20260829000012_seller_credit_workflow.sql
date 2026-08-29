begin;

create table if not exists public.seller_credit_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  max_uplift_pct numeric(7,2) not null default 3.00
    check (max_uplift_pct between 0 and 100),
  tax_rate_pct numeric(7,2) not null default 0
    check (tax_rate_pct between 0 and 100),
  max_credit_use_pct numeric(7,2) not null default 100
    check (max_credit_use_pct between 0 and 100),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rep_id uuid not null references public.sales_reps(id) on delete restrict,
  source_order_id uuid references public.sales_orders(id) on delete set null,
  entry_type text not null check (entry_type in ('earned','used','reversed','manual_credit','manual_debit')),
  amount numeric(14,2) not null check (amount <> 0),
  gross_amount numeric(14,2) not null default 0 check (gross_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  description text not null check (char_length(description) between 3 and 1000),
  idempotency_key uuid not null default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint seller_credit_ledger_idempotency_key
    unique (tenant_id, idempotency_key, entry_type)
);

alter table public.sales_orders
  add column if not exists price_uplift_pct numeric(7,2) not null default 0,
  add column if not exists seller_credit_gross_amount numeric(14,2) not null default 0,
  add column if not exists seller_credit_tax_amount numeric(14,2) not null default 0,
  add column if not exists seller_credit_earned numeric(14,2) not null default 0,
  add column if not exists seller_credit_used numeric(14,2) not null default 0,
  add column if not exists idempotency_key uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_orders_price_uplift_pct_check'
      and conrelid = 'public.sales_orders'::regclass
  ) then
    alter table public.sales_orders
      add constraint sales_orders_price_uplift_pct_check
      check (price_uplift_pct between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_orders_credit_amounts_check'
      and conrelid = 'public.sales_orders'::regclass
  ) then
    alter table public.sales_orders
      add constraint sales_orders_credit_amounts_check
      check (
        seller_credit_gross_amount >= 0
        and seller_credit_tax_amount >= 0
        and seller_credit_earned >= 0
        and seller_credit_used >= 0
      );
  end if;
end
$$;

create unique index if not exists sales_orders_tenant_idempotency_idx
  on public.sales_orders(tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists seller_credit_ledger_rep_created_idx
  on public.seller_credit_ledger(tenant_id, rep_id, created_at desc);

create index if not exists seller_credit_ledger_order_idx
  on public.seller_credit_ledger(tenant_id, source_order_id);

alter table public.seller_credit_settings enable row level security;
alter table public.seller_credit_ledger enable row level security;

revoke all on public.seller_credit_settings, public.seller_credit_ledger
  from public, anon, authenticated;
grant select on public.seller_credit_ledger to authenticated;
grant all on public.seller_credit_settings, public.seller_credit_ledger to service_role;

drop policy if exists seller_credit_settings_manager_read on public.seller_credit_settings;
create policy seller_credit_settings_manager_read
  on public.seller_credit_settings
  for select
  to authenticated
  using (private.has_tenant_role(tenant_id, array['owner','admin','manager']::text[]));

drop policy if exists seller_credit_ledger_read on public.seller_credit_ledger;
create policy seller_credit_ledger_read
  on public.seller_credit_ledger
  for select
  to authenticated
  using (
    private.has_tenant_role(tenant_id, array['owner','admin','manager']::text[])
    or exists (
      select 1
      from public.sales_reps rep
      where rep.id = seller_credit_ledger.rep_id
        and rep.tenant_id = seller_credit_ledger.tenant_id
        and rep.user_id = (select auth.uid())
        and rep.active
    )
  );

create or replace function private.touch_seller_credit_settings_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.touch_seller_credit_settings_updated_at() from public, anon, authenticated;

drop trigger if exists seller_credit_settings_touch_updated_at on public.seller_credit_settings;
create trigger seller_credit_settings_touch_updated_at
before update on public.seller_credit_settings
for each row execute function private.touch_seller_credit_settings_updated_at();

create or replace function public.create_assisted_order_with_credit(
  p_tenant_id uuid,
  p_rep_id uuid,
  p_customer_id uuid,
  p_lead_name text,
  p_lead_email text,
  p_lead_phone text,
  p_lead_cnpj text,
  p_notes text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount numeric,
  p_total numeric,
  p_status text,
  p_price_uplift_pct numeric default 0,
  p_credit_used numeric default 0,
  p_actor_user_id uuid default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rep_id uuid;
  v_existing_id uuid;
  v_enabled boolean := false;
  v_max_uplift_pct numeric := 0;
  v_tax_rate_pct numeric := 0;
  v_max_credit_use_pct numeric := 100;
  v_available numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_earned numeric := 0;
  v_item jsonb;
  v_item_price numeric;
  v_table_price numeric;
  v_qty numeric;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_tenant_id is null or p_rep_id is null or p_actor_user_id is null then
    raise exception 'tenant, vendedor e operador são obrigatórios';
  end if;
  if p_status not in ('rascunho', 'enviado') then
    raise exception 'status do pedido inválido';
  end if;
  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0
     or pg_catalog.jsonb_array_length(p_items) > 100 then
    raise exception 'itens do pedido inválidos';
  end if;
  if coalesce(p_price_uplift_pct, 0) < 0
     or coalesce(p_credit_used, 0) < 0
     or coalesce(p_total, 0) < 0 then
    raise exception 'valores comerciais inválidos';
  end if;

  select id into v_rep_id
  from public.sales_reps
  where id = p_rep_id
    and tenant_id = p_tenant_id
    and user_id = p_actor_user_id
    and active
  for update;

  if v_rep_id is null then
    raise exception 'vendedor não pertence ao ambiente ou está inativo';
  end if;

  select
    coalesce(enabled, false),
    coalesce(max_uplift_pct, 0),
    coalesce(tax_rate_pct, 0),
    coalesce(max_credit_use_pct, 100)
  into v_enabled, v_max_uplift_pct, v_tax_rate_pct, v_max_credit_use_pct
  from public.seller_credit_settings
  where tenant_id = p_tenant_id;

  if p_idempotency_key is not null then
    select id into v_existing_id
    from public.sales_orders
    where tenant_id = p_tenant_id
      and idempotency_key = p_idempotency_key
    limit 1;
    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  if (coalesce(p_price_uplift_pct, 0) > 0 or coalesce(p_credit_used, 0) > 0)
     and not v_enabled then
    raise exception 'crédito comercial está desativado para este ambiente';
  end if;
  if coalesce(p_price_uplift_pct, 0) > v_max_uplift_pct then
    raise exception 'acréscimo acima do limite configurado';
  end if;
  if coalesce(p_price_uplift_pct, 0) > 0
     and coalesce(p_credit_used, 0) > 0 then
    raise exception 'não é possível gerar e usar crédito no mesmo pedido';
  end if;
  if p_status = 'rascunho'
     and (coalesce(p_price_uplift_pct, 0) > 0 or coalesce(p_credit_used, 0) > 0) then
    raise exception 'crédito só pode ser gerado ou usado ao enviar o pedido';
  end if;

  for v_item in
    select value from pg_catalog.jsonb_array_elements(p_items)
  loop
    begin
      v_item_price := (v_item->>'price')::numeric;
      v_table_price := (v_item->>'table_price')::numeric;
      v_qty := (v_item->>'qty')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'preço ou quantidade do item inválido';
    end;

    if v_item_price is null or v_table_price is null or v_qty is null
       or v_item_price < 0 or v_table_price < 0 or v_qty <= 0 then
      raise exception 'dados do item inválidos';
    end if;
    v_gross := v_gross
      + pg_catalog.greatest(v_item_price - v_table_price, 0) * v_qty;
  end loop;

  v_gross := pg_catalog.round(v_gross, 2);
  v_tax := pg_catalog.round(v_gross * v_tax_rate_pct / 100, 2);
  v_earned := pg_catalog.round(v_gross - v_tax, 2);

  if coalesce(p_price_uplift_pct, 0) = 0 and v_gross > 0.01 then
    raise exception 'pedido contém acréscimo sem percentual autorizado';
  end if;
  if coalesce(p_price_uplift_pct, 0) > 0 and v_gross <= 0.01 then
    raise exception 'pedido não gerou acréscimo elegível';
  end if;

  if coalesce(p_credit_used, 0) > 0 then
    select coalesce(sum(amount), 0)
    into v_available
    from public.seller_credit_ledger
    where tenant_id = p_tenant_id
      and rep_id = p_rep_id;

    if p_credit_used > pg_catalog.round(v_available * v_max_credit_use_pct / 100, 2) then
      raise exception 'crédito insuficiente para esta negociação';
    end if;
  end if;

  insert into public.sales_orders (
    rep_id, customer_id, tenant_id, lead_name, lead_email, lead_phone, lead_cnpj,
    items, subtotal, discount, total, status, notes,
    price_uplift_pct, seller_credit_gross_amount, seller_credit_tax_amount,
    seller_credit_earned, seller_credit_used, idempotency_key
  )
  values (
    p_rep_id, p_customer_id, p_tenant_id, p_lead_name, p_lead_email, p_lead_phone, p_lead_cnpj,
    p_items, coalesce(p_subtotal, 0), coalesce(p_discount, 0), coalesce(p_total, 0), p_status, p_notes,
    coalesce(p_price_uplift_pct, 0), v_gross, v_tax, v_earned, coalesce(p_credit_used, 0), p_idempotency_key
  )
  returning id into v_existing_id;

  if v_earned > 0 then
    insert into public.seller_credit_ledger (
      tenant_id, rep_id, source_order_id, entry_type, amount,
      gross_amount, tax_amount, description, idempotency_key, created_by
    )
    values (
      p_tenant_id, p_rep_id, v_existing_id, 'earned', v_earned,
      v_gross, v_tax, 'Crédito gerado por acréscimo comercial', p_idempotency_key, p_actor_user_id
    )
    on conflict (tenant_id, idempotency_key, entry_type) do nothing;
  end if;

  if coalesce(p_credit_used, 0) > 0 then
    insert into public.seller_credit_ledger (
      tenant_id, rep_id, source_order_id, entry_type, amount,
      gross_amount, tax_amount, description, idempotency_key, created_by
    )
    values (
      p_tenant_id, p_rep_id, v_existing_id, 'used', -pg_catalog.round(p_credit_used, 2),
      0, 0, 'Crédito utilizado como desconto comercial', p_idempotency_key, p_actor_user_id
    )
    on conflict (tenant_id, idempotency_key, entry_type) do nothing;
  end if;

  return v_existing_id;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'dados comerciais inválidos';
end;
$$;

revoke all on function public.create_assisted_order_with_credit(
  uuid, uuid, uuid, text, text, text, text, text, jsonb,
  numeric, numeric, numeric, text, numeric, numeric, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_assisted_order_with_credit(
  uuid, uuid, uuid, text, text, text, text, text, jsonb,
  numeric, numeric, numeric, text, numeric, numeric, uuid, uuid
) to service_role;

comment on function public.create_assisted_order_with_credit(
  uuid, uuid, uuid, text, text, text, text, text, jsonb,
  numeric, numeric, numeric, text, numeric, numeric, uuid, uuid
) is 'Cria pedido assistido e registra crédito comercial de forma atômica.';

insert into public.seller_credit_settings (tenant_id, enabled, max_uplift_pct, tax_rate_pct, max_credit_use_pct)
select id, false, 3.00, 0, 100
from public.tenants
where id in (
  '87fee723-b111-411e-827e-ea6e67fd29ae',
  'cac303d1-063c-44fc-8df4-8827b3d3b6f8'
)
on conflict (tenant_id) do nothing;

notify pgrst, 'reload schema';

commit;