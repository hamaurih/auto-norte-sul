-- Omnichannel Order Core: SITE + PDV + WHATSAPP/VENDEDOR
-- Keeps specialized operational tables while materializing every effective sale
-- into public.orders as the canonical commercial record.

insert into public.sales_channels (
  tenant_id, code, name, active, is_default,
  tax_pct, payment_fee_pct, sales_commission_pct, marketplace_fee_pct,
  freight_subsidy_pct, anticipation_pct, expected_loss_pct, other_variable_pct,
  fixed_fee_per_sale
)
select
  t.id, v.code, v.name, true, false,
  0,0,0,0,0,0,0,0,0
from public.tenants t
cross join (values
  ('pdv','PDV / Balcão'),
  ('whatsapp','WhatsApp'),
  ('vendedor','Venda assistida')
) as v(code,name)
where t.slug='norte-sul-real' and t.environment='production'
on conflict (tenant_id,code)
do update set
  name=excluded.name,
  active=true,
  is_default=false,
  updated_at=now();

create or replace function private.assign_storefront_site_channel()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_channel_id uuid;
begin
  -- Explicit channel always wins. This is what allows the same orders table to
  -- receive SITE, PDV, WhatsApp and assisted sales without cross-tagging.
  if new.sales_channel_id is not null then
    return new;
  end if;

  if new.user_id is not null and new.idempotency_key is not null then
    select sc.id into v_channel_id
    from public.sales_channels sc
    where sc.tenant_id=new.tenant_id
      and sc.code='site'
      and sc.active
    limit 1;

    if v_channel_id is not null then
      new.sales_channel_id := v_channel_id;
    end if;
  end if;
  return new;
end;
$$;

alter table public.pos_sales
  add column if not exists order_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='pos_sales_order_tenant_fkey'
      and conrelid='public.pos_sales'::regclass
  ) then
    alter table public.pos_sales
      add constraint pos_sales_order_tenant_fkey
      foreign key (order_id,tenant_id)
      references public.orders(id,tenant_id)
      on delete set null (order_id);
  end if;
end $$;

create unique index if not exists pos_sales_tenant_order_uidx
  on public.pos_sales(tenant_id,order_id)
  where order_id is not null;

alter table public.sales_orders
  add column if not exists source_channel_code text not null default 'whatsapp';

alter table public.sales_orders
  drop constraint if exists sales_orders_source_channel_code_check;

alter table public.sales_orders
  add constraint sales_orders_source_channel_code_check
  check (source_channel_code in ('whatsapp','vendedor'));

create or replace function private.ensure_pos_sale_core_order(p_sale_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.pos_sales%rowtype;
  c public.customers%rowtype;
  v_order_id uuid;
  v_channel_id uuid;
  v_branch_id uuid;
  v_payment_method text;
  v_distinct_methods integer;
  i record;
begin
  select * into s
  from public.pos_sales
  where id=p_sale_id
  for update;

  if not found then raise exception 'POS_SALE_NOT_FOUND'; end if;
  if s.order_id is not null then return s.order_id; end if;
  if s.status<>'paid' then return null; end if;

  select count(distinct pp.method),
         case when count(distinct pp.method)=1 then max(pp.method) else 'misto' end
  into v_distinct_methods,v_payment_method
  from public.pos_payments pp
  where pp.tenant_id=s.tenant_id
    and pp.sale_id=s.id
    and pp.status='confirmed';

  if coalesce((
    select sum(pp.amount)
    from public.pos_payments pp
    where pp.tenant_id=s.tenant_id
      and pp.sale_id=s.id
      and pp.status='confirmed'
  ),0) <> s.total then
    return null;
  end if;

  v_payment_method := case v_payment_method
    when 'cash' then 'dinheiro'
    when 'pix' then 'pix'
    when 'debit_card' then 'debito'
    when 'credit_card' then 'cartao'
    when 'store_credit' then 'credito_loja'
    when 'b2b_invoice' then 'faturado_b2b'
    when 'misto' then 'misto'
    else coalesce(v_payment_method,'misto')
  end;

  select sc.id into v_channel_id
  from public.sales_channels sc
  where sc.tenant_id=s.tenant_id and sc.code='pdv' and sc.active
  limit 1;
  if v_channel_id is null then raise exception 'PDV_CHANNEL_NOT_CONFIGURED'; end if;

  select w.branch_id into v_branch_id
  from public.warehouses w
  where w.id=s.warehouse_id and w.tenant_id=s.tenant_id;

  if s.customer_id is not null then
    select * into c
    from public.customers
    where id=s.customer_id and tenant_id=s.tenant_id;
  end if;

  insert into public.orders (
    tenant_id,user_id,customer_id,idempotency_key,status,
    subtotal,shipping,discount,total,payment_method,
    customer_name,customer_email,customer_phone,customer_document,
    notes,sales_channel_id,fulfillment_type,pickup_branch_id,pickup_status,picked_up_at
  )
  values (
    s.tenant_id,
    s.operator_id,
    s.customer_id,
    s.idempotency_key,
    'aguardando_pagamento',
    s.subtotal,0,s.discount_amount,s.total,v_payment_method,
    coalesce(nullif(c.name,''),'Consumidor final'),
    coalesce(nullif(c.email,''),'sem-email@pdv.local'),
    c.phone,c.document,
    'Pedido canônico originado da venda PDV '||s.id::text,
    v_channel_id,
    'pickup',
    v_branch_id,
    'picked_up',
    now()
  )
  returning id into v_order_id;

  for i in
    select psi.product_id,psi.quantity,psi.unit_price,psi.line_total,
           p.sku,p.name
    from public.pos_sale_items psi
    join public.products p
      on p.id=psi.product_id and p.tenant_id=psi.tenant_id
    where psi.tenant_id=s.tenant_id and psi.sale_id=s.id
  loop
    insert into public.order_items (
      tenant_id,order_id,product_id,sku,name,quantity,
      list_price,unit_price,price_discount_pct,discount_amount,total
    )
    values (
      s.tenant_id,v_order_id,i.product_id,i.sku,i.name,i.quantity,
      i.unit_price,i.unit_price,0,0,i.line_total
    );
  end loop;

  update public.orders
  set status='pago',updated_at=now()
  where id=v_order_id and tenant_id=s.tenant_id;

  update public.pos_sales
  set order_id=v_order_id
  where id=s.id and tenant_id=s.tenant_id;

  return v_order_id;
end;
$$;

revoke all on function private.ensure_pos_sale_core_order(uuid)
from public,anon,authenticated;

create or replace function private.on_pos_payment_materialize_order()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='confirmed' then
    perform private.ensure_pos_sale_core_order(new.sale_id);
  end if;
  return new;
end;
$$;

revoke all on function private.on_pos_payment_materialize_order()
from public,anon,authenticated;

drop trigger if exists trg_pos_payment_materialize_order on public.pos_payments;
create trigger trg_pos_payment_materialize_order
after insert or update of status,amount
on public.pos_payments
for each row
execute function private.on_pos_payment_materialize_order();

create or replace function private.on_pos_sale_sync_core_status()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.order_id is not null
     and old.status is distinct from new.status
     and new.status='cancelled' then
    update public.orders
    set status='cancelado',
        notes=concat_ws(E'\n',nullif(notes,''),'Cancelado a partir do PDV em '||now()::text),
        updated_at=now()
    where tenant_id=new.tenant_id
      and id=new.order_id
      and status<>'cancelado';
  end if;
  return new;
end;
$$;

revoke all on function private.on_pos_sale_sync_core_status()
from public,anon,authenticated;

drop trigger if exists trg_pos_sale_sync_core_status on public.pos_sales;
create trigger trg_pos_sale_sync_core_status
after update of status
on public.pos_sales
for each row
execute function private.on_pos_sale_sync_core_status();

create or replace function private.ensure_assisted_sale_core_order(p_sales_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.sales_orders%rowtype;
  rep public.sales_reps%rowtype;
  cust public.customers%rowtype;
  v_channel_id uuid;
  v_order_id uuid;
  v_warehouse_id uuid;
  v_stock public.product_stock%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_price numeric;
  v_table_price numeric;
begin
  select * into s
  from public.sales_orders
  where id=p_sales_order_id
  for update;

  if not found then raise exception 'ASSISTED_ORDER_NOT_FOUND'; end if;
  if s.order_id is not null then return s.order_id; end if;
  if s.status<>'enviado' then return null; end if;

  select * into rep
  from public.sales_reps
  where id=s.rep_id and tenant_id=s.tenant_id and active;
  if not found then raise exception 'SALES_REP_NOT_FOUND'; end if;

  if s.customer_id is not null then
    select * into cust
    from public.customers
    where id=s.customer_id and tenant_id=s.tenant_id;
  end if;

  select sc.id into v_channel_id
  from public.sales_channels sc
  where sc.tenant_id=s.tenant_id
    and sc.code=s.source_channel_code
    and sc.active
  limit 1;
  if v_channel_id is null then raise exception 'ASSISTED_CHANNEL_NOT_CONFIGURED'; end if;

  insert into public.orders (
    tenant_id,user_id,customer_id,idempotency_key,status,is_b2b,
    subtotal,shipping,discount,total,
    customer_name,customer_email,customer_phone,customer_document,
    notes,sales_channel_id,fulfillment_type
  )
  values (
    s.tenant_id,
    rep.user_id,
    s.customer_id,
    s.idempotency_key,
    'aguardando_pagamento',
    true,
    s.subtotal,0,s.discount,s.total,
    coalesce(nullif(cust.name,''),nullif(s.lead_name,''),'Cliente WhatsApp'),
    coalesce(nullif(cust.email,''),nullif(s.lead_email,''),'sem-email@whatsapp.local'),
    coalesce(cust.phone,s.lead_phone),
    coalesce(cust.document,s.lead_cnpj),
    concat_ws(E'\n',nullif(s.notes,''),'Pedido assistido '||s.id::text),
    v_channel_id,
    'delivery'
  )
  returning id into v_order_id;

  for v_item in
    select value from jsonb_array_elements(s.items)
  loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty<=0 then raise exception 'INVALID_ASSISTED_ITEM'; end if;

    select * into v_product
    from public.products p
    where p.id=(v_item->>'product_id')::uuid
      and p.tenant_id=s.tenant_id
      and p.active
      and p.deleted_at is null
    for share;
    if not found then raise exception 'ASSISTED_PRODUCT_UNAVAILABLE'; end if;

    v_price := round((v_item->>'price')::numeric,2);
    v_table_price := round(coalesce((v_item->>'table_price')::numeric,v_price),2);
    if v_price<0 or v_table_price<0 then raise exception 'INVALID_ASSISTED_PRICE'; end if;

    select ps.* into v_stock
    from public.product_stock ps
    join public.warehouses w
      on w.id=ps.warehouse_id and w.tenant_id=ps.tenant_id
    where ps.tenant_id=s.tenant_id
      and ps.product_id=v_product.id
      and w.active
      and (ps.on_hand-ps.reserved)>=v_qty
    order by w.is_default desc,(ps.on_hand-ps.reserved) desc
    for update of ps skip locked
    limit 1;

    if not found then raise exception 'INSUFFICIENT_STOCK:%',v_product.id; end if;

    update public.product_stock
    set reserved=reserved+v_qty,updated_at=now()
    where id=v_stock.id;

    insert into public.order_items (
      tenant_id,order_id,product_id,sku,name,quantity,
      list_price,unit_price,price_table,price_discount_pct,discount_amount,total
    )
    values (
      s.tenant_id,v_order_id,v_product.id,v_product.sku,v_product.name,v_qty,
      greatest(v_table_price,v_price),v_price,
      nullif(v_item->>'price_table',''),
      case when v_table_price>0 then greatest(0,round(((v_table_price-v_price)/v_table_price)*100,2)) else 0 end,
      greatest(0,round((v_table_price-v_price)*v_qty,2)),
      round(v_price*v_qty,2)
    );

    insert into public.stock_reservations (
      tenant_id,order_id,product_id,warehouse_id,quantity,expires_at
    )
    values (
      s.tenant_id,v_order_id,v_product.id,v_stock.warehouse_id,v_qty,now()+interval '2 hours'
    );
  end loop;

  update public.sales_orders
  set order_id=v_order_id,updated_at=now()
  where id=s.id and tenant_id=s.tenant_id;

  return v_order_id;
end;
$$;

revoke all on function private.ensure_assisted_sale_core_order(uuid)
from public,anon,authenticated;

create or replace function private.on_sales_order_materialize_core()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='enviado'
     and new.order_id is null
     and (old.status is distinct from new.status
          or old.source_channel_code is distinct from new.source_channel_code
          or new.updated_at is distinct from old.updated_at) then
    perform private.ensure_assisted_sale_core_order(new.id);
  end if;
  return new;
end;
$$;

revoke all on function private.on_sales_order_materialize_core()
from public,anon,authenticated;

drop trigger if exists trg_sales_order_materialize_core on public.sales_orders;
create trigger trg_sales_order_materialize_core
after update of status,source_channel_code,updated_at
on public.sales_orders
for each row
execute function private.on_sales_order_materialize_core();

create index if not exists pos_sales_order_id_idx
  on public.pos_sales(tenant_id,order_id)
  where order_id is not null;

create index if not exists sales_orders_core_order_idx
  on public.sales_orders(tenant_id,order_id)
  where order_id is not null;
