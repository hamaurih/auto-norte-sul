begin;

-- Idempotência: o mesmo clique/reenvio não gera orçamentos duplicados.
alter table public.quotes add column if not exists storefront_request_key uuid;
create unique index if not exists quotes_storefront_request_unique
  on public.quotes(tenant_id,created_by,storefront_request_key)
  where storefront_request_key is not null;

-- RPC exclusivamente para o servidor (service_role). O cliente não escolhe preço,
-- desconto, documento, cliente nem status: tudo é recuperado do banco.
create or replace function public.internal_create_storefront_quote(
  p_tenant_id uuid,
  p_user_id uuid,
  p_items jsonb,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_email text;
  v_customer public.customers%rowtype;
  v_existing record;
  v_validated jsonb;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_price numeric(12,2);
  v_base numeric(12,2);
  v_specific numeric(12,2);
  v_subtotal numeric(12,2):=0;
  v_discount_pct numeric(7,2):=0;
  v_table text:='C';
  v_settings record;
  v_lines jsonb:='[]'::jsonb;
  v_quote_id uuid;
  v_number bigint;
begin
  if p_tenant_id is null or p_user_id is null or p_request_key is null then
    raise exception 'INVALID_QUOTE_REQUEST';
  end if;
  if not exists (select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'TENANT_NOT_FOUND';
  end if;
  select u.email into v_email from auth.users u where u.id=p_user_id;
  if v_email is null then raise exception 'CUSTOMER_EMAIL_REQUIRED'; end if;
  v_email:=lower(btrim(v_email));

  select * into v_existing
  from public.quotes q
  where q.tenant_id=p_tenant_id
    and q.created_by=p_user_id
    and q.storefront_request_key=p_request_key
    and q.deleted_at is null;
  if found then
    return jsonb_build_object('ok',true,'reused',true,'id',v_existing.id,'number',v_existing.number);
  end if;

  select * into v_customer
  from public.customers c
  where c.tenant_id=p_tenant_id and c.user_id=p_user_id
  for update;
  if not found then
    insert into public.customers(
      tenant_id,user_id,name,email,customer_group,b2b_status,active,source
    ) values(
      p_tenant_id,p_user_id,left(split_part(v_email,'@',1),160),v_email,
      'b2c','none',true,'site'
    )
    on conflict (tenant_id,user_id) do update set updated_at=now()
    returning * into v_customer;
  end if;
  if not v_customer.active then raise exception 'CUSTOMER_DISABLED'; end if;

  if v_customer.customer_group::text in ('revendedor','oficina','distribuidor')
     and v_customer.b2b_status::text='approved' then
    select coalesce(a.price_table,'C') into v_table
    from public.b2b_customer_price_tables a
    where a.tenant_id=p_tenant_id and a.customer_id=v_customer.id and a.active
    limit 1;
    v_table:=coalesce(v_table,'C');
    select s.table_a_discount_pct,s.table_b_discount_pct,s.table_c_discount_pct
      into v_settings
    from public.b2b_price_table_settings s
    where s.tenant_id=p_tenant_id limit 1;
    v_discount_pct:=case v_table
      when 'A' then coalesce(v_settings.table_a_discount_pct,8)
      when 'B' then coalesce(v_settings.table_b_discount_pct,5)
      else coalesce(v_settings.table_c_discount_pct,0) end;
  end if;

  -- A validação existente é a mesma do checkout, sempre com valores do servidor.
  v_validated:=public.validate_cart_items(p_tenant_id,p_items);
  if jsonb_typeof(v_validated)<>'array' or jsonb_array_length(v_validated)=0 then
    raise exception 'QUOTE_WITHOUT_ITEMS';
  end if;
  for v_item in select value from jsonb_array_elements(v_validated) loop
    v_qty:=(v_item->>'quantity')::integer;
    select * into v_product from public.products p
    where p.id=(v_item->>'product_id')::uuid
      and p.tenant_id=p_tenant_id
      and p.active and p.available_for_online and p.deleted_at is null;
    if not found then raise exception 'PRODUCT_NOT_AVAILABLE_ON_SITE'; end if;

    -- A cotação não reserva estoque; apenas impede itens impossíveis.
    -- A reserva atômica acontece na conversão para pedido.
    if not exists (
      select 1 from public.product_stock ps
      join public.warehouses w on w.id=ps.warehouse_id and w.tenant_id=ps.tenant_id
      where ps.tenant_id=p_tenant_id and ps.product_id=v_product.id
        and w.active and ps.on_hand-ps.reserved>=v_qty
    ) then raise exception 'INSUFFICIENT_STOCK'; end if;

    v_price:=(v_item->>'unit_price')::numeric;
    if v_customer.customer_group::text in ('revendedor','oficina','distribuidor')
       and v_customer.b2b_status::text='approved' then
      v_base:=coalesce(v_product.price_b2b,v_product.sale_price_b2c,v_product.price_b2c);
      v_specific:=case v_table
        when 'A' then v_product.price_b2b_a
        when 'B' then v_product.price_b2b_b
        else v_product.price_b2b_c end;
      v_price:=round(coalesce(v_specific,v_base*(1-v_discount_pct/100)),2);
    end if;
    if v_price is null or v_price<=0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
    v_subtotal:=v_subtotal+round(v_price*v_qty,2);
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'product_id',v_product.id,'sku',v_product.sku,'name',v_product.name,
      'qty',v_qty,'unit_price',v_price,'total',round(v_price*v_qty,2)
    ));
  end loop;

  insert into public.quotes(
    tenant_id,customer_id,customer_name,customer_email,customer_phone,
    created_by,origin,status,document_type,title,
    subtotal,discount,shipping_amount,total,valid_until,sent_at,
    payment_terms,delivery_terms,storefront_request_key
  ) values(
    p_tenant_id,v_customer.id,v_customer.name,v_email,v_customer.phone,
    p_user_id,'site','enviado','orcamento','Orçamento pelo site',
    v_subtotal,0,0,v_subtotal,now()+interval '7 days',now(),
    'PIX, cartão ou boleto conforme cadastro',
    'Entrega ou retirada definidas no checkout. Frete a confirmar.',p_request_key
  )
  on conflict (tenant_id,created_by,storefront_request_key)
    where storefront_request_key is not null
    do nothing
  returning id,number into v_quote_id,v_number;

  if v_quote_id is null then
    select q.id,q.number into v_quote_id,v_number
    from public.quotes q
    where q.tenant_id=p_tenant_id and q.created_by=p_user_id
      and q.storefront_request_key=p_request_key;
    if v_quote_id is null then raise exception 'QUOTE_IDEMPOTENCY_FAILED'; end if;
    return jsonb_build_object('ok',true,'reused',true,'id',v_quote_id,'number',v_number);
  end if;

  insert into public.quote_items(
    tenant_id,quote_id,product_id,sku,name,qty,unit_price,discount,total
  )
  select p_tenant_id,v_quote_id,
    (line.value->>'product_id')::uuid,line.value->>'sku',line.value->>'name',
    (line.value->>'qty')::integer,(line.value->>'unit_price')::numeric,
    0,(line.value->>'total')::numeric
  from jsonb_array_elements(v_lines) line(value);

  insert into public.quote_events(tenant_id,quote_id,event_type,to_status,note,actor_user_id)
  values(p_tenant_id,v_quote_id,'criado','enviado','Gerado automaticamente no site, sem aprovação.',p_user_id);

  return jsonb_build_object('ok',true,'reused',false,'id',v_quote_id,'number',v_number);
end
$$;

revoke all on function public.internal_create_storefront_quote(uuid,uuid,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.internal_create_storefront_quote(uuid,uuid,jsonb,uuid)
  to service_role;


-- Corrige a conversão existente e remove a dependência de liberação manual.
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

  -- Autorização ANTES do retorno idempotente: um UUID alheio nunca expõe pedido.
  if q.customer_id is null then raise exception 'QUOTE_NOT_OWNED_BY_USER'; end if;
  select * into c
  from public.customers
  where id=q.customer_id
    and tenant_id=q.tenant_id
    and active
    and user_id=v_user;
  if not found then raise exception 'QUOTE_NOT_OWNED_BY_USER'; end if;

  if q.status='convertido' and q.converted_sales_order_id is not null then
    select * into so
    from public.sales_orders
    where id=q.converted_sales_order_id and tenant_id=q.tenant_id;
    if so.order_id is not null then
      return jsonb_build_object('ok',true,'reused',true,'order_id',so.order_id,'sales_order_id',so.id);
    end if;
  end if;

  -- Nenhuma aprovação humana: qualquer orçamento pertencente ao cliente,
  -- inclusive rascunho ou em negociação, pode ser comprado se ainda válido.
  if q.status not in ('rascunho','enviado','em_negociacao','aprovado') then
    raise exception 'QUOTE_NOT_AVAILABLE';
  end if;
  if q.valid_until is not null and q.valid_until < now() then
    raise exception 'QUOTE_EXPIRED';
  end if;

  select sr.id into v_rep_id
  from public.sales_reps sr
  where sr.tenant_id=q.tenant_id
    and sr.active
    and (sr.id=q.sales_rep_id or q.sales_rep_id is null)
  order by case when sr.id=q.sales_rep_id then 0 else 1 end, sr.created_at
  limit 1;
  if v_rep_id is null then
    -- Representante técnico para o canal Site; nenhum vendedor humano é exigido.
    insert into public.sales_reps(tenant_id,full_name,email,active,commission_pct,notes)
    values(q.tenant_id,'Loja virtual (automático)','canal-site@interno.invalid',true,0,
           'Representante técnico sem comissão, exclusivo do canal site.')
    on conflict (tenant_id,email) do update set active=true
    returning id into v_rep_id;
  end if;

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
      converted_sales_order_id=so.id,
      sales_rep_id=v_rep_id,
      updated_at=now()
  where id=q.id and tenant_id=q.tenant_id;

  insert into public.quote_events(
    tenant_id,quote_id,event_type,from_status,to_status,note,actor_user_id
  ) values (
    q.tenant_id,q.id,'convertido',q.status,'convertido',
    'Cliente transformou o orçamento em compra sem aprovação manual.',v_user
  );

  return jsonb_build_object('ok',true,'reused',false,'order_id',v_order_id,'sales_order_id',so.id);
end
$$;

revoke all on function public.convert_my_quote_to_storefront_order(uuid,text) from public,anon,authenticated;
grant execute on function public.convert_my_quote_to_storefront_order(uuid,text) to service_role;

commit;
