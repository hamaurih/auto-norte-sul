begin;

create or replace function public.convert_my_quote_to_storefront_order(
  p_quote_id uuid,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  q public.quotes%rowtype;
  c public.customers%rowtype;
  so public.sales_orders%rowtype;
  v_order_id uuid;
  v_rep_id uuid;
  v_channel_id uuid;
  v_item record;
  v_product public.products%rowtype;
  v_stock public.product_stock%rowtype;
  v_latest_order public.orders%rowtype;
  v_email text;
  v_auth_email text;
  v_items_json jsonb:='[]'::jsonb;
  v_is_b2b boolean:=false;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payment_method not in ('pix','cartao','boleto') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  select * into q
  from public.quotes
  where id=p_quote_id
    and deleted_at is null
  for update;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;

  if q.status='convertido' and q.converted_sales_order_id is not null then
    select * into so
    from public.sales_orders
    where id=q.converted_sales_order_id and tenant_id=q.tenant_id;
    if so.order_id is not null then
      return jsonb_build_object('ok',true,'reused',true,'order_id',so.order_id,'sales_order_id',so.id);
    end if;
  end if;

  if q.status not in ('enviado','aprovado') then
    raise exception 'QUOTE_NOT_RELEASED';
  end if;
  if q.valid_until is not null and q.valid_until < now() then
    raise exception 'QUOTE_EXPIRED';
  end if;
  select email into v_auth_email
  from auth.users
  where id=v_user;

  if q.customer_id is not null then
    select * into c
    from public.customers
    where id=q.customer_id
      and tenant_id=q.tenant_id
      and active
      and (
        user_id=v_user
        or (
          user_id is null
          and v_auth_email is not null
          and email is not null
          and lower(email)=lower(v_auth_email)
        )
      );
    if not found then raise exception 'QUOTE_NOT_OWNED_BY_USER'; end if;

    if c.user_id is null then
      update public.customers
      set user_id=v_user,updated_at=now()
      where id=c.id and tenant_id=q.tenant_id and user_id is null
      returning * into c;
    end if;
  else
    if v_auth_email is null
       or q.customer_email is null
       or lower(q.customer_email)<>lower(v_auth_email) then
      raise exception 'QUOTE_NOT_OWNED_BY_USER';
    end if;

    select * into c
    from public.customers
    where tenant_id=q.tenant_id
      and active
      and (
        user_id=v_user
        or (
          user_id is null
          and email is not null
          and lower(email)=lower(v_auth_email)
        )
      )
    order by case when user_id=v_user then 0 else 1 end,created_at
    limit 1
    for update;

    if found and c.user_id is null then
      update public.customers
      set user_id=v_user,updated_at=now()
      where id=c.id and tenant_id=q.tenant_id and user_id is null
      returning * into c;
    elsif not found then
      insert into public.customers(
        tenant_id,user_id,name,email,phone,customer_group,b2b_status,active,source
      ) values (
        q.tenant_id,v_user,coalesce(nullif(q.customer_name,''),split_part(v_auth_email,'@',1)),
        v_auth_email,q.customer_phone,'b2c','none',true,'quote'
      )
      returning * into c;
    end if;

    update public.quotes
    set customer_id=c.id,updated_at=now()
    where id=q.id and tenant_id=q.tenant_id and customer_id is null;
    q.customer_id:=c.id;
  end if;

  select sr.id into v_rep_id
  from public.sales_reps sr
  where sr.tenant_id=q.tenant_id
    and sr.active
    and (sr.id=q.sales_rep_id or q.sales_rep_id is null)
  order by case when sr.id=q.sales_rep_id then 0 else 1 end, sr.created_at
  limit 1;
  if v_rep_id is null then raise exception 'SALES_REP_REQUIRED'; end if;

  select sc.id into v_channel_id
  from public.sales_channels sc
  where sc.tenant_id=q.tenant_id
    and sc.code='site'
    and sc.active
  limit 1;
  if v_channel_id is null then raise exception 'SITE_CHANNEL_NOT_CONFIGURED'; end if;

  select * into v_latest_order
  from public.orders o
  where o.tenant_id=q.tenant_id
    and o.user_id=v_user
    and o.deleted_at is null
  order by o.created_at desc
  limit 1;

  v_email:=coalesce(nullif(q.customer_email,''),nullif(c.email,''),nullif(v_latest_order.customer_email,''));
  if v_email is null then
    select email into v_email from auth.users where id=v_user;
  end if;
  if v_email is null then raise exception 'CUSTOMER_EMAIL_REQUIRED'; end if;

  v_is_b2b := c.customer_group::text in ('revendedor','oficina','distribuidor')
              and c.b2b_status::text in ('approved','aprovado');

  for v_item in
    select qi.*
    from public.quote_items qi
    where qi.tenant_id=q.tenant_id
      and qi.quote_id=q.id
    order by qi.created_at,qi.id
  loop
    if v_item.product_id is null then raise exception 'QUOTE_ITEM_WITHOUT_PRODUCT:%',v_item.name; end if;
    if v_item.qty is null or v_item.qty<=0 or v_item.qty<>trunc(v_item.qty) then
      raise exception 'INVALID_QUOTE_QUANTITY:%',v_item.name;
    end if;

    select * into v_product
    from public.products p
    where p.id=v_item.product_id
      and p.tenant_id=q.tenant_id
      and p.active
      and p.available_for_online
      and p.deleted_at is null
    for share;
    if not found then raise exception 'PRODUCT_NOT_AVAILABLE_ON_SITE:%',v_item.name; end if;

    select ps.* into v_stock
    from public.product_stock ps
    join public.warehouses w on w.id=ps.warehouse_id and w.tenant_id=ps.tenant_id
    where ps.tenant_id=q.tenant_id
      and ps.product_id=v_product.id
      and w.active
      and (ps.on_hand-ps.reserved)>=v_item.qty
    order by w.is_default desc,(ps.on_hand-ps.reserved) desc
    for update of ps skip locked
    limit 1;
    if not found then
      raise exception 'INSUFFICIENT_STOCK:%',v_item.name;
    end if;

    v_items_json:=v_items_json||jsonb_build_array(jsonb_build_object(
      'product_id',v_product.id,
      'sku',v_item.sku,
      'name',v_item.name,
      'qty',v_item.qty,
      'price',v_item.unit_price,
      'discount',coalesce(v_item.discount,0),
      'total',v_item.total
    ));
  end loop;

  if jsonb_array_length(v_items_json)=0 then raise exception 'QUOTE_WITHOUT_ITEMS'; end if;

  insert into public.sales_orders(
    tenant_id,rep_id,customer_id,lead_name,lead_email,lead_phone,lead_cnpj,
    items,subtotal,discount,total,status,notes,idempotency_key,quote_id,
    source_channel_code,price_uplift_pct,seller_credit_used,seller_credit_earned
  ) values (
    q.tenant_id,v_rep_id,c.id,
    coalesce(nullif(q.customer_name,''),c.name),
    v_email,coalesce(q.customer_phone,c.phone),c.document,
    v_items_json,q.subtotal,q.discount,q.total,'enviado',
    concat_ws(E'\n',nullif(q.customer_notes,''),'Compra iniciada pelo cliente a partir do orçamento #'||q.number),
    gen_random_uuid(),q.id,'site',0,0,0
  )
  returning * into so;

  insert into public.orders(
    tenant_id,user_id,customer_id,idempotency_key,status,is_b2b,
    subtotal,shipping,discount,total,payment_method,
    customer_name,customer_email,customer_phone,customer_document,
    shipping_zip,shipping_street,shipping_number,shipping_complement,
    shipping_neighborhood,shipping_city,shipping_state,
    notes,sales_channel_id,fulfillment_type
  ) values (
    q.tenant_id,v_user,c.id,gen_random_uuid(),'aguardando_pagamento',v_is_b2b,
    q.subtotal,q.shipping_amount,q.discount,q.total,p_payment_method,
    coalesce(nullif(q.customer_name,''),c.name),v_email,coalesce(q.customer_phone,c.phone),c.document,
    v_latest_order.shipping_zip,v_latest_order.shipping_street,v_latest_order.shipping_number,v_latest_order.shipping_complement,
    v_latest_order.shipping_neighborhood,v_latest_order.shipping_city,v_latest_order.shipping_state,
    'Pedido criado pelo cliente a partir do orçamento #'||q.number,
    v_channel_id,'delivery'
  )
  returning id into v_order_id;

  for v_item in
    select qi.*
    from public.quote_items qi
    where qi.tenant_id=q.tenant_id
      and qi.quote_id=q.id
    order by qi.created_at,qi.id
  loop
    select * into v_product
    from public.products p
    where p.id=v_item.product_id and p.tenant_id=q.tenant_id;

    select ps.* into v_stock
    from public.product_stock ps
    join public.warehouses w on w.id=ps.warehouse_id and w.tenant_id=ps.tenant_id
    where ps.tenant_id=q.tenant_id
      and ps.product_id=v_product.id
      and w.active
      and (ps.on_hand-ps.reserved)>=v_item.qty
    order by w.is_default desc,(ps.on_hand-ps.reserved) desc
    for update of ps skip locked
    limit 1;
    if not found then raise exception 'INSUFFICIENT_STOCK:%',v_item.name; end if;

    update public.product_stock
    set reserved=reserved+v_item.qty,updated_at=now()
    where id=v_stock.id;

    insert into public.order_items(
      tenant_id,order_id,product_id,sku,name,quantity,
      list_price,unit_price,price_table,price_discount_pct,discount_amount,total
    ) values (
      q.tenant_id,v_order_id,v_product.id,coalesce(v_item.sku,v_product.sku),v_item.name,v_item.qty,
      v_item.unit_price,v_item.unit_price,null,0,coalesce(v_item.discount,0),v_item.total
    );

    insert into public.stock_reservations(
      tenant_id,order_id,product_id,warehouse_id,quantity,expires_at
    ) values (
      q.tenant_id,v_order_id,v_product.id,v_stock.warehouse_id,v_item.qty,now()+interval '2 hours'
    );
  end loop;

  update public.sales_orders
  set order_id=v_order_id,updated_at=now()
  where id=so.id and tenant_id=q.tenant_id;

  update public.quotes
  set status='convertido',
      closed_at=now(),
      approved_at=coalesce(approved_at,now()),
      converted_sales_order_id=so.id,
      sales_rep_id=v_rep_id,
      updated_at=now()
  where id=q.id and tenant_id=q.tenant_id;

  insert into public.quote_events(
    tenant_id,quote_id,event_type,from_status,to_status,note,actor_user_id
  ) values (
    q.tenant_id,q.id,'convertido',q.status,'convertido',
    'Cliente transformou o orçamento em compra.',v_user
  );

  return jsonb_build_object('ok',true,'reused',false,'order_id',v_order_id,'sales_order_id',so.id);
end
$$;

revoke all on function public.convert_my_quote_to_storefront_order(uuid,text) from public,anon;
grant execute on function public.convert_my_quote_to_storefront_order(uuid,text) to authenticated;

commit;