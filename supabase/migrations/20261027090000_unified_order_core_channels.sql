-- Unified Order Core for Site + PDV + WhatsApp.
-- Orders becomes the commercial source of truth. POS tables remain operational
-- extensions for cash register/history and no longer own stock mutation.

-- 1) Channels.
insert into public.sales_channels (
  tenant_id,code,name,active,is_default,
  tax_pct,payment_fee_pct,sales_commission_pct,marketplace_fee_pct,
  freight_subsidy_pct,anticipation_pct,expected_loss_pct,other_variable_pct,
  fixed_fee_per_sale
)
select t.id,'pdv','PDV / Balcão',true,false,0,0,0,0,0,0,0,0,0
from public.tenants t
where t.slug='norte-sul-real' and t.environment='production'
on conflict (tenant_id,code) do update
set name=excluded.name,active=true,is_default=false,updated_at=now();

insert into public.sales_channels (
  tenant_id,code,name,active,is_default,
  tax_pct,payment_fee_pct,sales_commission_pct,marketplace_fee_pct,
  freight_subsidy_pct,anticipation_pct,expected_loss_pct,other_variable_pct,
  fixed_fee_per_sale
)
select t.id,'whatsapp','WhatsApp',true,false,0,0,0,0,0,0,0,0,0
from public.tenants t
where t.slug='norte-sul-real' and t.environment='production'
on conflict (tenant_id,code) do update
set name=excluded.name,active=true,is_default=false,updated_at=now();

-- 2) Order ownership/origin model.
alter table public.orders alter column user_id drop not null;
alter table public.orders alter column customer_email drop not null;

alter table public.orders
  add column if not exists created_by_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists warehouse_id uuid null,
  add column if not exists cash_session_id uuid null,
  add column if not exists source_reference text null,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='orders_warehouse_tenant_fk'
  ) then
    alter table public.orders
      add constraint orders_warehouse_tenant_fk
      foreign key (warehouse_id,tenant_id)
      references public.warehouses(id,tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname='orders_cash_session_fkey'
  ) then
    alter table public.orders
      add constraint orders_cash_session_fkey
      foreign key (cash_session_id)
      references public.pos_cash_sessions(id);
  end if;
end $$;

create unique index if not exists uq_orders_channel_idempotency
on public.orders(tenant_id,sales_channel_id,idempotency_key)
where idempotency_key is not null and sales_channel_id is not null;

create unique index if not exists uq_orders_channel_source_reference
on public.orders(tenant_id,sales_channel_id,source_reference)
where source_reference is not null and sales_channel_id is not null;

alter table public.pos_sales add column if not exists order_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='pos_sales_order_tenant_fkey'
  ) then
    alter table public.pos_sales
      add constraint pos_sales_order_tenant_fkey
      foreign key (order_id,tenant_id)
      references public.orders(id,tenant_id);
  end if;
end $$;

create unique index if not exists uq_pos_sales_order
on public.pos_sales(tenant_id,order_id)
where order_id is not null;

-- 3) Storefront only assigns SITE when caller did not explicitly choose a channel.
create or replace function private.assign_storefront_site_channel()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_channel_id uuid;
begin
  if new.sales_channel_id is null
     and new.user_id is not null
     and new.idempotency_key is not null then
    select sc.id into v_channel_id
    from public.sales_channels sc
    where sc.tenant_id=new.tenant_id
      and sc.code='site'
      and sc.active
    limit 1;

    if v_channel_id is not null then
      new.sales_channel_id:=v_channel_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.assign_storefront_site_channel()
from public,anon,authenticated;

-- 4) Bling queue follows the order/channel, not presence of a storefront login.
create or replace function private.enqueue_bling_order_sync()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_event text;
begin
  if new.idempotency_key is null or new.deleted_at is not null then
    return new;
  end if;

  if tg_op='INSERT' then
    v_event:='created';
  elsif old.status is distinct from new.status then
    if new.status::text in ('paid','pago','faturado') then
      v_event:='paid';
    elsif new.status::text in ('cancelled','cancelado') then
      v_event:='cancelled';
    else
      return new;
    end if;
  else
    return new;
  end if;

  insert into public.bling_order_sync_jobs(
    tenant_id,order_id,event_type,status,scheduled_at
  )
  values(new.tenant_id,new.id,v_event,'queued',now())
  on conflict (tenant_id,order_id,event_type) do update
  set status=case when public.bling_order_sync_jobs.status='done' then 'done' else 'queued' end,
      scheduled_at=case when public.bling_order_sync_jobs.status='done'
        then public.bling_order_sync_jobs.scheduled_at else now() end,
      last_error=case when public.bling_order_sync_jobs.status='done'
        then public.bling_order_sync_jobs.last_error else null end,
      updated_at=now();

  if v_event='created' then
    update public.orders
    set bling_sync_status='queued',bling_sync_error=null
    where id=new.id;
  elsif v_event='paid' then
    update public.orders
    set bling_sync_status='fiscal_pending',bling_sync_error=null
    where id=new.id;
  elsif v_event='cancelled' then
    update public.orders
    set bling_sync_status='queued',bling_sync_error=null
    where id=new.id;
  end if;

  return new;
end;
$$;

revoke all on function private.enqueue_bling_order_sync()
from public,anon,authenticated;

-- 5) Core used by assisted channels (PDV/WhatsApp). The stable storefront
-- continues through its existing wrapper but already shares orders,
-- order_items, stock_reservations and transition_order.
create or replace function private.create_channel_order_core(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_channel_code text,
  p_warehouse_id uuid,
  p_idempotency_key uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_customer jsonb default '{}'::jsonb,
  p_payment_method text default null,
  p_discount_amount numeric default 0,
  p_source_reference text default null,
  p_source_metadata jsonb default '{}'::jsonb,
  p_fulfillment_type text default 'delivery',
  p_pickup_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_channel_id uuid;
  v_order_id uuid;
  v_customer public.customers%rowtype;
  v_effective_customer_id uuid:=p_customer_id;
  v_product public.products%rowtype;
  v_stock public.product_stock%rowtype;
  v_item jsonb;
  v_qty integer;
  v_list_price numeric(14,2);
  v_specific_price numeric(14,2);
  v_unit_price numeric(14,2);
  v_item_discount_pct numeric(8,4);
  v_subtotal numeric(14,2):=0;
  v_total numeric(14,2);
  v_is_b2b boolean:=false;
  v_price_table text:='C';
  v_b2b_discount numeric(8,4):=0;
  v_role text;
  v_max_discount numeric(8,4):=0;
  v_order_discount_pct numeric(8,4):=0;
  v_customer_user_id uuid;
  v_customer_name text;
  v_customer_email text;
  v_customer_phone text;
  v_customer_document text;
begin
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'EMPTY_ORDER';
  end if;
  if coalesce(p_discount_amount,0)<0 then raise exception 'INVALID_DISCOUNT'; end if;
  if p_fulfillment_type not in ('delivery','pickup') then raise exception 'INVALID_FULFILLMENT'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) i
    group by i->>'product_id'
    having count(*)>1
  ) then raise exception 'DUPLICATE_PRODUCT'; end if;

  select sc.id into v_channel_id
  from public.sales_channels sc
  where sc.tenant_id=p_tenant_id
    and sc.code=p_channel_code
    and sc.active
  limit 1;
  if v_channel_id is null then raise exception 'INVALID_SALES_CHANNEL:%',p_channel_code; end if;

  select o.id into v_order_id
  from public.orders o
  where o.tenant_id=p_tenant_id
    and o.sales_channel_id=v_channel_id
    and o.idempotency_key=p_idempotency_key
  limit 1;
  if v_order_id is not null then return v_order_id; end if;

  if p_source_reference is not null then
    select o.id into v_order_id
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.sales_channel_id=v_channel_id
      and o.source_reference=p_source_reference
    limit 1;
    if v_order_id is not null then return v_order_id; end if;
  end if;

  if p_actor_user_id is not null then
    select tm.role into v_role
    from public.tenant_memberships tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=p_actor_user_id
      and tm.active
      and tm.role in ('owner','admin','manager','sales','cashier')
    order by case tm.role
      when 'owner' then 1 when 'admin' then 2 when 'manager' then 3
      when 'sales' then 4 when 'cashier' then 5 else 99 end
    limit 1;
    if v_role is null then raise exception 'FORBIDDEN'; end if;
  elsif p_channel_code='pdv' then
    raise exception 'PDV_ACTOR_REQUIRED';
  end if;

  if not exists (
    select 1 from public.warehouses w
    where w.id=p_warehouse_id and w.tenant_id=p_tenant_id and w.active
  ) then raise exception 'INVALID_WAREHOUSE'; end if;

  if p_fulfillment_type='pickup' and p_pickup_branch_id is not null and not exists (
    select 1 from public.branches b
    where b.id=p_pickup_branch_id and b.tenant_id=p_tenant_id and b.active
  ) then raise exception 'INVALID_PICKUP_BRANCH'; end if;

  -- Resolve the commercial customer without confusing operator and buyer.
  -- PDV anonymous sales reuse the active "Consumidor Final" already linked to Bling.
  if v_effective_customer_id is null and p_channel_code='pdv' then
    select c.id into v_effective_customer_id
    from public.customers c
    where c.tenant_id=p_tenant_id
      and c.active
      and lower(btrim(c.name))='consumidor final'
      and c.bling_id is not null
    order by c.created_at
    limit 1;
  end if;

  -- WhatsApp attempts deterministic customer reuse by document, then phone.
  if v_effective_customer_id is null and p_channel_code='whatsapp' then
    v_customer_document:=nullif(regexp_replace(coalesce(p_customer->>'document',''),'\D','','g'),'');
    v_customer_phone:=nullif(regexp_replace(coalesce(p_customer->>'phone',''),'\D','','g'),'');
    if v_customer_document is not null then
      select c.id into v_effective_customer_id
      from public.customers c
      where c.tenant_id=p_tenant_id and c.active and c.document=v_customer_document
      order by c.updated_at desc
      limit 1;
    end if;
    if v_effective_customer_id is null and v_customer_phone is not null then
      select c.id into v_effective_customer_id
      from public.customers c
      where c.tenant_id=p_tenant_id and c.active
        and regexp_replace(coalesce(c.phone,''),'\D','','g')=v_customer_phone
      order by c.updated_at desc
      limit 1;
    end if;
    if v_effective_customer_id is null then
      insert into public.customers(
        tenant_id,name,email,phone,document,customer_group,b2b_status,active,source,source_payload
      )
      values(
        p_tenant_id,
        coalesce(nullif(btrim(p_customer->>'name'),''),'Cliente WhatsApp'),
        nullif(lower(btrim(coalesce(p_customer->>'email',''))),''),
        nullif(btrim(coalesce(p_customer->>'phone','')),''),
        v_customer_document,
        'b2c','none',true,'whatsapp',
        jsonb_build_object('created_by','order_core','source_reference',p_source_reference)
      )
      returning id into v_effective_customer_id;
    end if;
  end if;

  if v_effective_customer_id is not null then
    select * into v_customer
    from public.customers c
    where c.id=v_effective_customer_id and c.tenant_id=p_tenant_id and c.active
    for share;
    if not found then raise exception 'INVALID_CUSTOMER'; end if;

    v_customer_user_id:=v_customer.user_id;
    v_customer_name:=coalesce(nullif(btrim(v_customer.name),''),'Consumidor final');
    v_customer_email:=nullif(lower(btrim(coalesce(v_customer.email,''))),'');
    v_customer_phone:=nullif(btrim(coalesce(v_customer.phone,'')),'');
    v_customer_document:=nullif(btrim(coalesce(v_customer.document,'')),'');
    v_is_b2b:=v_customer.customer_group in ('revendedor','oficina','distribuidor')
      and v_customer.b2b_status='approved';
  else
    v_customer_name:=coalesce(nullif(btrim(p_customer->>'name'),''),'Consumidor final');
    v_customer_email:=nullif(lower(btrim(coalesce(p_customer->>'email',''))),'');
    v_customer_phone:=nullif(btrim(coalesce(p_customer->>'phone','')),'');
    v_customer_document:=nullif(regexp_replace(coalesce(p_customer->>'document',''),'\D','','g'),'');
  end if;

  if v_is_b2b then
    select
      coalesce(a.price_table,'C'),
      case coalesce(a.price_table,'C')
        when 'A' then coalesce(s.table_a_discount_pct,8)
        when 'B' then coalesce(s.table_b_discount_pct,5)
        else coalesce(s.table_c_discount_pct,0)
      end
    into v_price_table,v_b2b_discount
    from (select 1) seed
    left join public.b2b_customer_price_tables a
      on a.tenant_id=p_tenant_id
     and a.customer_id=v_effective_customer_id
     and a.active
    left join public.b2b_price_table_settings s
      on s.tenant_id=p_tenant_id and s.active
    limit 1;
  end if;

  begin
    insert into public.orders(
      tenant_id,user_id,created_by_user_id,customer_id,
      status,is_b2b,b2b_price_table,b2b_price_discount_pct,
      subtotal,shipping,discount,total,payment_method,
      customer_name,customer_email,customer_phone,customer_document,
      shipping_zip,shipping_street,shipping_number,shipping_complement,
      shipping_neighborhood,shipping_city,shipping_state,
      sales_channel_id,warehouse_id,idempotency_key,
      source_reference,source_metadata,
      fulfillment_type,pickup_branch_id,pickup_status
    )
    values(
      p_tenant_id,v_customer_user_id,p_actor_user_id,v_effective_customer_id,
      'aguardando_pagamento',v_is_b2b,
      case when v_is_b2b then v_price_table end,
      case when v_is_b2b then v_b2b_discount else 0 end,
      0,0,coalesce(p_discount_amount,0),0,p_payment_method,
      v_customer_name,v_customer_email,v_customer_phone,v_customer_document,
      nullif(btrim(coalesce(p_customer->>'shipping_zip','')),''),
      nullif(btrim(coalesce(p_customer->>'shipping_street','')),''),
      nullif(btrim(coalesce(p_customer->>'shipping_number','')),''),
      nullif(btrim(coalesce(p_customer->>'shipping_complement','')),''),
      nullif(btrim(coalesce(p_customer->>'shipping_neighborhood','')),''),
      nullif(btrim(coalesce(p_customer->>'shipping_city','')),''),
      upper(nullif(btrim(coalesce(p_customer->>'shipping_state','')),'')),
      v_channel_id,p_warehouse_id,p_idempotency_key,
      p_source_reference,coalesce(p_source_metadata,'{}'::jsonb),
      p_fulfillment_type,p_pickup_branch_id,
      case when p_fulfillment_type='pickup' then 'awaiting_preparation' else null end
    )
    returning id into v_order_id;
  exception when unique_violation then
    select o.id into v_order_id
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.sales_channel_id=v_channel_id
      and (
        o.idempotency_key=p_idempotency_key
        or (p_source_reference is not null and o.source_reference=p_source_reference)
      )
    order by o.created_at
    limit 1;
    if v_order_id is null then raise; end if;
    return v_order_id;
  end;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty:=(v_item->>'quantity')::integer;
    if v_qty<=0 then raise exception 'INVALID_ITEM'; end if;

    select * into v_product
    from public.products p
    where p.id=(v_item->>'product_id')::uuid
      and p.tenant_id=p_tenant_id
      and p.active and p.deleted_at is null
    for share;
    if not found then raise exception 'PRODUCT_UNAVAILABLE:%',v_item->>'product_id'; end if;

    if v_is_b2b then
      v_list_price:=coalesce(v_product.price_b2b,v_product.sale_price_b2c,v_product.price_b2c);
      v_specific_price:=case v_price_table
        when 'A' then v_product.price_b2b_a
        when 'B' then v_product.price_b2b_b
        else v_product.price_b2b_c
      end;
      if v_specific_price is not null and v_specific_price>=0 then
        v_unit_price:=round(v_specific_price,2);
        v_list_price:=greatest(v_list_price,v_unit_price);
        v_item_discount_pct:=case when v_list_price>0
          then greatest(0,round(((v_list_price-v_unit_price)/v_list_price)*100,2))
          else 0 end;
      else
        v_unit_price:=round(v_list_price*(1-v_b2b_discount/100),2);
        v_item_discount_pct:=v_b2b_discount;
      end if;
    else
      v_list_price:=coalesce(v_product.sale_price_b2c,v_product.price_b2c);
      v_unit_price:=v_list_price;
      v_item_discount_pct:=0;
    end if;

    if v_unit_price is null or v_unit_price<=0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;

    select * into v_stock
    from public.product_stock s
    where s.tenant_id=p_tenant_id
      and s.warehouse_id=p_warehouse_id
      and s.product_id=v_product.id
    for update;
    if not found or (coalesce(v_stock.on_hand,0)-coalesce(v_stock.reserved,0))<v_qty then
      raise exception 'INSUFFICIENT_STOCK:%',v_product.id;
    end if;

    update public.product_stock s
    set reserved=s.reserved+v_qty,updated_at=now()
    where s.id=v_stock.id;

    insert into public.order_items(
      tenant_id,order_id,product_id,sku,name,quantity,
      list_price,unit_price,price_table,price_discount_pct,
      discount_amount,total
    )
    values(
      p_tenant_id,v_order_id,v_product.id,v_product.sku,v_product.name,v_qty,
      v_list_price,v_unit_price,
      case when v_is_b2b then v_price_table end,
      case when v_is_b2b then v_item_discount_pct else 0 end,
      round(greatest(v_list_price-v_unit_price,0)*v_qty,2),
      round(v_unit_price*v_qty,2)
    );

    insert into public.stock_reservations(
      tenant_id,order_id,product_id,warehouse_id,quantity
    )
    values(p_tenant_id,v_order_id,v_product.id,p_warehouse_id,v_qty);

    v_subtotal:=v_subtotal+round(v_unit_price*v_qty,2);
  end loop;

  if coalesce(p_discount_amount,0)>v_subtotal then raise exception 'INVALID_DISCOUNT'; end if;

  if coalesce(p_discount_amount,0)>0 then
    v_order_discount_pct:=case when v_subtotal>0
      then (p_discount_amount/v_subtotal)*100 else 100 end;

    if p_actor_user_id is null then
      raise exception 'DISCOUNT_REQUIRES_OPERATOR';
    elsif v_role not in ('owner','admin','manager') then
      select coalesce(sr.max_discount_pct,0) into v_max_discount
      from public.sales_reps sr
      where sr.tenant_id=p_tenant_id
        and sr.user_id=p_actor_user_id
        and sr.active
      limit 1;
      v_max_discount:=coalesce(v_max_discount,0);
      if v_order_discount_pct>v_max_discount+0.0001 then
        raise exception 'DISCOUNT_LIMIT_EXCEEDED:%',round(v_max_discount,2);
      end if;
    end if;
  end if;

  v_total:=round(v_subtotal-coalesce(p_discount_amount,0),2);

  update public.orders
  set subtotal=v_subtotal,
      discount=coalesce(p_discount_amount,0),
      total=v_total,
      updated_at=now()
  where id=v_order_id and tenant_id=p_tenant_id;

  return v_order_id;
end;
$$;

revoke all on function private.create_channel_order_core(
  uuid,uuid,text,uuid,uuid,jsonb,uuid,jsonb,text,numeric,text,jsonb,text,uuid
) from public,anon,authenticated;
grant execute on function private.create_channel_order_core(
  uuid,uuid,text,uuid,uuid,jsonb,uuid,jsonb,text,numeric,text,jsonb,text,uuid
) to service_role;

-- 6) PDV now creates an ERP order first, then records the cash-register extension.
create or replace function private.finalize_pos_sale(
  p_tenant_id uuid,
  p_cash_session_id uuid,
  p_idempotency_key uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount_amount numeric default 0,
  p_customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_session public.pos_cash_sessions;
  v_sale_id uuid;
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_payment jsonb;
  v_paid numeric(14,2):=0;
  v_method text;
  v_provider_reference text;
  v_payment_count integer;
  v_order_payment_method text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'EMPTY_SALE'; end if;
  if jsonb_typeof(p_payments)<>'array' or jsonb_array_length(p_payments)=0 then raise exception 'PAYMENT_REQUIRED'; end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.id=p_cash_session_id
    and s.tenant_id=p_tenant_id
    and s.status='open'
  for update;
  if not found then raise exception 'CASH_SESSION_NOT_OPEN'; end if;

  if v_session.operator_id<>v_user and not exists(
    select 1 from public.tenant_memberships tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user and tm.active
      and tm.role in ('owner','admin','manager')
  ) then raise exception 'SESSION_OWNED_BY_ANOTHER_OPERATOR'; end if;

  select ps.id into v_sale_id
  from public.pos_sales ps
  where ps.tenant_id=p_tenant_id and ps.idempotency_key=p_idempotency_key
  limit 1;
  if v_sale_id is not null then return v_sale_id; end if;

  v_payment_count:=jsonb_array_length(p_payments);

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    v_method:=v_payment->>'method';
    v_provider_reference:=nullif(btrim(coalesce(v_payment->>'provider_reference','')),'');

    if v_method not in ('cash','pix','debit_card','credit_card','store_credit','b2b_invoice') then
      raise exception 'INVALID_PAYMENT_METHOD';
    end if;
    if (v_payment->>'amount')::numeric<=0 then raise exception 'INVALID_PAYMENT'; end if;
    if v_method in ('pix','debit_card','credit_card') and v_provider_reference is null then
      raise exception 'PAYMENT_REFERENCE_REQUIRED:%',v_method;
    end if;
    if v_method='b2b_invoice' and v_payment_count<>1 then
      raise exception 'B2B_INVOICE_CANNOT_BE_MIXED';
    end if;
    v_paid:=v_paid+round((v_payment->>'amount')::numeric,2);
  end loop;

  if v_payment_count=1 then
    select case e.value->>'method'
      when 'b2b_invoice' then 'faturado_b2b'
      else e.value->>'method'
    end
    into v_order_payment_method
    from jsonb_array_elements(p_payments) as e(value)
    limit 1;
  else
    v_order_payment_method:='mixed';
  end if;

  v_order_id:=private.create_channel_order_core(
    p_tenant_id,
    v_user,
    'pdv',
    v_session.warehouse_id,
    p_idempotency_key,
    p_items,
    p_customer_id,
    jsonb_build_object('name','Consumidor final'),
    v_order_payment_method,
    coalesce(p_discount_amount,0),
    'PDV:'||p_idempotency_key::text,
    jsonb_build_object(
      'cash_session_id',v_session.id,
      'terminal_code',v_session.terminal_code,
      'branch_id',v_session.branch_id
    ),
    'pickup',
    v_session.branch_id
  );

  select * into v_order
  from public.orders o
  where o.id=v_order_id and o.tenant_id=p_tenant_id
  for update;

  if round(v_paid,2)<>round(v_order.total,2) then
    raise exception 'PAYMENT_TOTAL_MISMATCH';
  end if;

  if v_order_payment_method='faturado_b2b' then
    perform private.transition_order(v_order_id,'approve_b2b_invoice',v_user);
  else
    perform private.transition_order(v_order_id,'confirm_payment',v_user);
  end if;

  update public.orders
  set cash_session_id=v_session.id,
      fulfillment_type='pickup',
      pickup_branch_id=v_session.branch_id,
      pickup_status='picked_up',
      pickup_ready_at=coalesce(pickup_ready_at,now()),
      picked_up_at=now(),
      updated_at=now()
  where id=v_order_id and tenant_id=p_tenant_id;

  insert into public.pos_sales(
    tenant_id,cash_session_id,warehouse_id,operator_id,customer_id,
    status,subtotal,discount_amount,total,idempotency_key,order_id
  )
  select
    p_tenant_id,v_session.id,v_session.warehouse_id,v_user,p_customer_id,
    'paid',o.subtotal,o.discount,o.total,p_idempotency_key,o.id
  from public.orders o
  where o.id=v_order_id
  returning id into v_sale_id;

  insert into public.pos_sale_items(
    tenant_id,sale_id,product_id,quantity,unit_price,line_total
  )
  select
    oi.tenant_id,v_sale_id,oi.product_id,oi.quantity,oi.unit_price,oi.total
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=v_order_id;

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    insert into public.pos_payments(
      tenant_id,sale_id,method,amount,installments,provider,provider_reference,status
    )
    values(
      p_tenant_id,v_sale_id,v_payment->>'method',
      (v_payment->>'amount')::numeric,
      coalesce((v_payment->>'installments')::integer,1),
      nullif(v_payment->>'provider',''),
      nullif(v_payment->>'provider_reference',''),
      'confirmed'
    );
  end loop;

  return v_sale_id;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_SALE_PAYLOAD';
end;
$$;

comment on function private.finalize_pos_sale(uuid,uuid,uuid,jsonb,jsonb,numeric,uuid)
is 'Finaliza PDV sobre o Order Core: cria orders/order_items/reserva, confirma pagamento pelo transition_order e mantém pos_* somente como extensão de caixa.';

-- 7) POS cancellation reverses its already-consumed stock and mirrors commercial status.
create or replace function private.cancel_pos_sale(p_sale_id uuid,p_reason text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_sale public.pos_sales;
  v_item record;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'CANCELLATION_REASON_REQUIRED'; end if;

  select * into v_sale
  from public.pos_sales ps
  where ps.id=p_sale_id
  for update;
  if not found then raise exception 'SALE_NOT_FOUND'; end if;

  if not exists(
    select 1 from public.tenant_memberships tm
    where tm.tenant_id=v_sale.tenant_id and tm.user_id=v_user and tm.active
      and tm.role in ('owner','admin','manager')
  ) then raise exception 'CANCELLATION_REQUIRES_MANAGER'; end if;

  if v_sale.status='cancelled' then return v_sale.id; end if;
  if v_sale.status<>'paid' then raise exception 'SALE_NOT_CANCELLABLE'; end if;
  if v_sale.fiscal_status in ('authorized','cancellation_pending') then
    raise exception 'FISCAL_CANCELLATION_REQUIRED';
  end if;
  if exists(
    select 1 from public.pos_payments pp
    where pp.sale_id=v_sale.id and pp.status='confirmed' and pp.provider is not null
  ) then raise exception 'PAYMENT_REVERSAL_REQUIRED'; end if;

  for v_item in
    select psi.product_id,psi.quantity
    from public.pos_sale_items psi
    where psi.sale_id=v_sale.id
    for update
  loop
    update public.product_stock
    set on_hand=on_hand+v_item.quantity,updated_at=now()
    where tenant_id=v_sale.tenant_id
      and warehouse_id=v_sale.warehouse_id
      and product_id=v_item.product_id;
    if not found then raise exception 'STOCK_ROW_NOT_FOUND:%',v_item.product_id; end if;

    insert into public.stock_movements(
      tenant_id,product_id,warehouse_id,type,qty,reference,notes,user_id
    )
    values(
      v_sale.tenant_id,v_item.product_id,v_sale.warehouse_id,'IN',v_item.quantity,
      'PDV-CANCEL-'||v_sale.id::text,
      'Cancelamento PDV: '||btrim(p_reason),v_user
    );
  end loop;

  update public.pos_payments
  set status='refunded'
  where sale_id=v_sale.id and status='confirmed';

  update public.pos_sales
  set status='cancelled',cancelled_at=now()
  where id=v_sale.id;

  if v_sale.order_id is not null then
    update public.orders
    set status='cancelado',
        pickup_status=case when fulfillment_type='pickup' then 'cancelled' else pickup_status end,
        notes=concat_ws(E'\n',nullif(notes,''),'Cancelamento PDV: '||btrim(p_reason)),
        updated_at=now()
    where id=v_sale.order_id and tenant_id=v_sale.tenant_id;
  end if;

  return v_sale.id;
end;
$$;

-- 8) WhatsApp contract: service-role only, same Order Core.
create or replace function public.create_whatsapp_order(
  p_tenant_id uuid,
  p_idempotency_key uuid,
  p_warehouse_id uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_customer jsonb default '{}'::jsonb,
  p_payment_method text default 'pix',
  p_source_reference text default null,
  p_source_metadata jsonb default '{}'::jsonb,
  p_fulfillment_type text default 'delivery',
  p_pickup_branch_id uuid default null
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.create_channel_order_core(
    p_tenant_id,
    null,
    'whatsapp',
    p_warehouse_id,
    p_idempotency_key,
    p_items,
    p_customer_id,
    p_customer,
    p_payment_method,
    0,
    p_source_reference,
    p_source_metadata,
    p_fulfillment_type,
    p_pickup_branch_id
  );
$$;

revoke all on function public.create_whatsapp_order(
  uuid,uuid,uuid,jsonb,uuid,jsonb,text,text,jsonb,text,uuid
) from public,anon,authenticated;
grant execute on function public.create_whatsapp_order(
  uuid,uuid,uuid,jsonb,uuid,jsonb,text,text,jsonb,text,uuid
) to service_role;

create or replace function public.confirm_whatsapp_order_payment(
  p_order_id uuid,
  p_payment_reference text default null
)
returns public.order_status
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_channel_code text;
  v_status public.order_status;
begin
  select o.* into v_order
  from public.orders o
  where o.id=p_order_id
  for update;

  if not found then raise exception 'WHATSAPP_ORDER_NOT_FOUND'; end if;

  select sc.code into v_channel_code
  from public.sales_channels sc
  where sc.id=v_order.sales_channel_id and sc.tenant_id=v_order.tenant_id;

  if v_channel_code is distinct from 'whatsapp' then
    raise exception 'WHATSAPP_ORDER_NOT_FOUND';
  end if;

  if v_order.payment_method='faturado_b2b' then
    v_status:=private.transition_order(v_order.id,'approve_b2b_invoice',null);
  else
    v_status:=private.transition_order(v_order.id,'confirm_payment',null);
  end if;

  if nullif(btrim(coalesce(p_payment_reference,'')),'') is not null then
    update public.orders
    set source_metadata=coalesce(source_metadata,'{}'::jsonb)
      || jsonb_build_object('payment_reference',btrim(p_payment_reference)),
      updated_at=now()
    where id=v_order.id;
  end if;

  return v_status;
end;
$$;

revoke all on function public.confirm_whatsapp_order_payment(uuid,text)
from public,anon,authenticated;
grant execute on function public.confirm_whatsapp_order_payment(uuid,text)
to service_role;

create or replace function public.cancel_whatsapp_order(
  p_order_id uuid,
  p_reason text default null
)
returns public.order_status
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_channel_code text;
  v_status public.order_status;
begin
  select sc.code into v_channel_code
  from public.orders o
  join public.sales_channels sc
    on sc.id=o.sales_channel_id and sc.tenant_id=o.tenant_id
  where o.id=p_order_id;

  if v_channel_code is distinct from 'whatsapp' then
    raise exception 'WHATSAPP_ORDER_NOT_FOUND';
  end if;

  v_status:=private.transition_order(p_order_id,'cancel',null);

  if nullif(btrim(coalesce(p_reason,'')),'') is not null then
    update public.orders
    set notes=concat_ws(E'\n',nullif(notes,''),'Cancelamento WhatsApp: '||btrim(p_reason)),
        updated_at=now()
    where id=p_order_id;
  end if;

  return v_status;
end;
$$;

revoke all on function public.cancel_whatsapp_order(uuid,text)
from public,anon,authenticated;
grant execute on function public.cancel_whatsapp_order(uuid,text)
to service_role;

-- 9) Null-customer orders are staff-only through existing RLS; tighten the
-- ownership predicates explicitly for nullable user_id.
drop policy if exists orders_tenant_read on public.orders;
create policy orders_tenant_read
on public.orders for select
to authenticated
using (
  ((select auth.uid()) is not null and user_id=(select auth.uid()))
  or (select private.has_tenant_role(orders.tenant_id,null::text[]))
);

drop policy if exists tenant_user_permission_select on public.orders;
create policy tenant_user_permission_select
on public.orders for select
to authenticated
using (
  ((select auth.uid()) is not null and user_id=(select auth.uid()))
  or private.has_tenant_module_permission(tenant_id,'sales','view')
);

-- Cancellation auth must handle operational orders where user_id is NULL.
create or replace function private.transition_order(
  p_order_id uuid,
  p_action text,
  p_actor_user_id uuid default null
)
returns public.order_status
language plpgsql
security definer
set search_path=''
as $$
declare
  sale public.orders%rowtype;
  reservation public.stock_reservations%rowtype;
  next_status public.order_status;
  is_staff boolean;
  invoice_days integer:=28;
begin
  select current_order.* into sale
  from public.orders current_order
  where current_order.id=p_order_id
  for update;
  if not found then raise exception 'order not found'; end if;

  select exists(
    select 1 from public.tenant_memberships membership
    where membership.tenant_id=sale.tenant_id
      and membership.user_id=p_actor_user_id
      and membership.active
      and membership.role=any(array['owner','admin','manager','sales','cashier','finance','stock'])
  ) into is_staff;

  if p_action in ('confirm_payment','approve_b2b_invoice') then
    if p_action='confirm_payment'
       and p_actor_user_id is not null
       and not is_staff then
      raise exception 'payment confirmation requires staff';
    end if;

    if p_action='approve_b2b_invoice' then
      if sale.status='faturado' then return sale.status; end if;
      if sale.status<>'aguardando_pagamento'
         or not sale.is_b2b
         or sale.payment_method<>'faturado_b2b' then
        raise exception 'order is not eligible for B2B invoicing';
      end if;

      select a.invoice_due_days into invoice_days
      from public.b2b_customer_price_tables a
      where a.tenant_id=sale.tenant_id
        and a.customer_id=sale.customer_id
        and a.active and a.allow_invoice;
      if not found then raise exception 'B2B invoicing is not authorized for this customer'; end if;
    else
      if sale.status='pago' then return sale.status; end if;
      if sale.status<>'aguardando_pagamento' then
        raise exception 'order cannot be paid from status %',sale.status;
      end if;
    end if;

    for reservation in
      select r.* from public.stock_reservations r
      where r.order_id=sale.id and r.tenant_id=sale.tenant_id
      order by r.product_id,r.warehouse_id
      for update
    loop
      if reservation.status<>'active' then
        raise exception 'order reservation is not active';
      end if;

      update public.product_stock s
      set on_hand=s.on_hand-reservation.quantity,
          reserved=s.reserved-reservation.quantity
      where s.tenant_id=reservation.tenant_id
        and s.product_id=reservation.product_id
        and s.warehouse_id=reservation.warehouse_id
        and s.on_hand>=reservation.quantity
        and s.reserved>=reservation.quantity;
      if not found then raise exception 'stock invariant violation while consuming reservation'; end if;

      update public.stock_reservations r
      set status='consumed',updated_at=now()
      where r.id=reservation.id;

      insert into public.stock_movements(
        tenant_id,product_id,warehouse_id,type,qty,reference,notes,user_id
      )
      values(
        reservation.tenant_id,reservation.product_id,reservation.warehouse_id,
        'OUT',reservation.quantity,'ORDER:'||sale.id::text,
        case when p_action='approve_b2b_invoice'
          then 'Baixa automática após aprovação de faturado B2B'
          else 'Baixa automática após confirmação de pagamento' end,
        p_actor_user_id
      );
    end loop;

    if p_action='approve_b2b_invoice' then
      next_status:='faturado';
      insert into public.financial_receivables(
        tenant_id,source_type,source_id,customer_id,customer_name,
        description,amount,due_date,payment_method,status,notes
      )
      values(
        sale.tenant_id,'b2b_order',sale.id,sale.customer_id,sale.customer_name,
        'Pedido B2B faturado #'||left(sale.id::text,8),
        sale.total,current_date+invoice_days,'faturado_b2b','open',
        'Gerado automaticamente pelo Order Core.'
      )
      on conflict (tenant_id,source_type,source_id) do update
      set customer_id=excluded.customer_id,
          customer_name=excluded.customer_name,
          amount=excluded.amount,
          due_date=excluded.due_date,
          payment_method=excluded.payment_method,
          status=case when public.financial_receivables.status='received'
            then public.financial_receivables.status else 'open' end,
          updated_at=now();
    else
      next_status:='pago';
    end if;

  elsif p_action in ('cancel','expire') then
    if p_action='cancel'
       and p_actor_user_id is not null
       and (sale.user_id is null or p_actor_user_id<>sale.user_id)
       and not is_staff then
      raise exception 'order cancellation is not authorized';
    end if;
    if sale.status='cancelado' then return sale.status; end if;
    if sale.status<>'aguardando_pagamento' then
      raise exception 'consumed or fulfilled orders require a return workflow';
    end if;

    for reservation in
      select r.* from public.stock_reservations r
      where r.order_id=sale.id
        and r.tenant_id=sale.tenant_id
        and r.status='active'
      order by r.product_id,r.warehouse_id
      for update
    loop
      if p_action='expire' and reservation.expires_at>now() then
        raise exception 'reservation has not expired';
      end if;

      update public.product_stock s
      set reserved=s.reserved-reservation.quantity
      where s.tenant_id=reservation.tenant_id
        and s.product_id=reservation.product_id
        and s.warehouse_id=reservation.warehouse_id
        and s.reserved>=reservation.quantity;
      if not found then raise exception 'stock invariant violation while releasing reservation'; end if;

      update public.stock_reservations r
      set status=case when p_action='expire' then 'expired' else 'released' end,
          updated_at=now()
      where r.id=reservation.id;

      insert into public.stock_movements(
        tenant_id,product_id,warehouse_id,type,qty,reference,notes,user_id
      )
      values(
        reservation.tenant_id,reservation.product_id,reservation.warehouse_id,
        'RELEASE',reservation.quantity,'ORDER:'||sale.id::text,
        case when p_action='expire'
          then 'Liberação automática de reserva expirada'
          else 'Liberação de reserva após cancelamento' end,
        p_actor_user_id
      );
    end loop;

    next_status:='cancelado';
  else
    raise exception 'unsupported order action';
  end if;

  update public.orders o
  set status=next_status,
      payment_due_days=case when p_action='approve_b2b_invoice'
        then invoice_days else o.payment_due_days end,
      notes=case when p_action='expire'
        then concat_ws(E'\n',nullif(o.notes,''),'Reserva expirada automaticamente em '||now()::text)
        else o.notes end
  where o.id=sale.id;

  return next_status;
end;
$$;

revoke all on function private.transition_order(uuid,text,uuid)
from public,anon,authenticated;
grant execute on function private.transition_order(uuid,text,uuid)
to service_role;
