begin;

-- A solicitação comercial não altera o orçamento originalmente emitido.
-- Uma oferta aceita é uma nova versão vinculada ao documento original.
create table if not exists public.quote_commercial_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quote_id uuid not null,
  customer_id uuid not null,
  requested_user_id uuid not null references auth.users(id),
  requested_benefit text not null default 'conditions'
    check (requested_benefit in ('conditions','discount','credit')),
  customer_message text,
  status text not null default 'pending'
    check (status in ('pending','offered','denied','converted')),
  original_total numeric(12,2) not null check (original_total>=0),
  additional_discount numeric(12,2) not null default 0 check (additional_discount>=0),
  offered_total numeric(12,2),
  offered_quote_id uuid,
  credit_mode text not null default 'none'
    check (credit_mode in ('none','invoice')),
  credit_days int check (credit_days is null or credit_days between 1 and 120),
  manager_note text,
  reviewed_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  offer_expires_at timestamptz,
  converted_order_id uuid,
  converted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint quote_reviews_quote_tenant_fk
    foreign key(quote_id,tenant_id) references public.quotes(id,tenant_id) on delete cascade,
  constraint quote_reviews_customer_tenant_fk
    foreign key(customer_id,tenant_id) references public.customers(id,tenant_id),
  constraint quote_reviews_offer_quote_tenant_fk
    foreign key(offered_quote_id,tenant_id) references public.quotes(id,tenant_id),
  constraint quote_reviews_order_tenant_fk
    foreign key(converted_order_id,tenant_id) references public.orders(id,tenant_id),
  constraint quote_reviews_unique_source unique(tenant_id,quote_id),
  constraint quote_reviews_unique_offer unique(tenant_id,offered_quote_id),
  constraint quote_reviews_offer_consistency check (
    (status <> 'offered') or (offered_quote_id is not null and reviewed_by is not null and offer_expires_at is not null)
  )
);

create index if not exists quote_reviews_queue_idx
  on public.quote_commercial_reviews(tenant_id,status,requested_at desc);
create index if not exists quote_reviews_customer_idx
  on public.quote_commercial_reviews(tenant_id,customer_id,requested_at desc);

alter table public.quote_commercial_reviews enable row level security;
revoke all on public.quote_commercial_reviews from public,anon,authenticated;
grant select,insert,update,delete on public.quote_commercial_reviews to service_role;

create or replace function public.internal_request_quote_commercial_review(
  p_tenant_id uuid, p_user_id uuid, p_quote_id uuid,
  p_benefit text, p_message text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_quote public.quotes%rowtype;
  v_customer public.customers%rowtype;
  v_review public.quote_commercial_reviews%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_tenant_id is null or p_user_id is null or p_quote_id is null then raise exception 'INVALID_REQUEST'; end if;
  if p_benefit not in ('conditions','discount','credit') then raise exception 'INVALID_BENEFIT'; end if;
  if length(coalesce(p_message,''))>500 then raise exception 'MESSAGE_TOO_LONG'; end if;

  select * into v_quote from public.quotes
  where id=p_quote_id and tenant_id=p_tenant_id and deleted_at is null for update;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  if v_quote.origin<>'site' then raise exception 'ONLY_STOREFRONT_QUOTES'; end if;
  if v_quote.status not in ('rascunho','enviado','em_negociacao','aprovado') then
    raise exception 'QUOTE_NOT_AVAILABLE';
  end if;
  if v_quote.valid_until is not null and v_quote.valid_until<now() then raise exception 'QUOTE_EXPIRED'; end if;
  select * into v_customer from public.customers
   where id=v_quote.customer_id and tenant_id=p_tenant_id
     and user_id=p_user_id and active;
  if not found then raise exception 'QUOTE_NOT_OWNED_BY_USER'; end if;

  select * into v_review from public.quote_commercial_reviews
    where tenant_id=p_tenant_id and quote_id=v_quote.id for update;
  if found and v_review.status in ('pending','offered') then
    return jsonb_build_object('ok',true,'reused',true,'id',v_review.id,'status',v_review.status);
  end if;
  if found then
    update public.quote_commercial_reviews set
      status='pending', requested_benefit=p_benefit,
      customer_message=nullif(btrim(p_message),''),
      original_total=v_quote.total, requested_at=now(),updated_at=now(),
      additional_discount=0,offered_total=null,offered_quote_id=null,
      credit_mode='none',credit_days=null,manager_note=null,reviewed_by=null,
      reviewed_at=null,offer_expires_at=null,converted_order_id=null,converted_at=null
    where id=v_review.id returning * into v_review;
  else
    insert into public.quote_commercial_reviews(
      tenant_id,quote_id,customer_id,requested_user_id,
      requested_benefit,customer_message,original_total
    ) values (
      p_tenant_id,v_quote.id,v_customer.id,p_user_id,
      p_benefit,nullif(btrim(p_message),''),v_quote.total
    ) returning * into v_review;
  end if;

  insert into public.quote_events(tenant_id,quote_id,event_type,note,actor_user_id)
  values(p_tenant_id,v_quote.id,'analise_solicitada',
         'Cliente enviou o orçamento para análise comercial.',p_user_id);
  return jsonb_build_object('ok',true,'reused',false,'id',v_review.id,'status','pending');
end
$$;
revoke all on function public.internal_request_quote_commercial_review(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.internal_request_quote_commercial_review(uuid,uuid,uuid,text,text)
  to service_role;

create or replace function public.internal_decide_quote_commercial_review(
  p_tenant_id uuid,p_manager_id uuid,p_review_id uuid,p_decision text,
  p_additional_discount numeric,p_credit_mode text,p_manager_note text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_review public.quote_commercial_reviews%rowtype;
  v_quote public.quotes%rowtype;
  v_customer public.customers%rowtype;
  v_offer_id uuid;
  v_offer_number bigint;
  v_offer_total numeric(12,2);
  v_expiry timestamptz;
  v_credit_days int;
  v_version int;
  v_item_count int;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_tenant_id is null or p_manager_id is null or p_review_id is null then raise exception 'INVALID_REQUEST'; end if;
  if not exists (
    select 1 from public.tenant_memberships m where m.tenant_id=p_tenant_id
      and m.user_id=p_manager_id and m.active and m.role in ('owner','admin','manager')
  ) then raise exception 'MANAGER_PERMISSION_REQUIRED'; end if;
  if p_decision not in ('offer','deny') then raise exception 'INVALID_DECISION'; end if;
  if length(coalesce(p_manager_note,''))>1000 then raise exception 'NOTE_TOO_LONG'; end if;

  select * into v_review from public.quote_commercial_reviews
    where id=p_review_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if v_review.status<>'pending' then raise exception 'REVIEW_ALREADY_DECIDED'; end if;
  select * into v_quote from public.quotes
    where id=v_review.quote_id and tenant_id=p_tenant_id and deleted_at is null for update;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  if v_quote.status in ('convertido','recusado','expirado') or
    (v_quote.valid_until is not null and v_quote.valid_until<now()) then
    raise exception 'QUOTE_NOT_AVAILABLE';
  end if;
  select * into v_customer from public.customers
    where tenant_id=p_tenant_id and id=v_review.customer_id
      and user_id=v_review.requested_user_id and active;
  if not found then raise exception 'CUSTOMER_NOT_AVAILABLE'; end if;

  if p_decision='deny' then
    if length(btrim(coalesce(p_manager_note,'')))<3 then raise exception 'DENIAL_REASON_REQUIRED'; end if;
    update public.quote_commercial_reviews set
      status='denied',manager_note=p_manager_note,reviewed_by=p_manager_id,
      reviewed_at=now(),updated_at=now()
    where id=v_review.id;
    insert into public.quote_events(tenant_id,quote_id,event_type,note,actor_user_id)
    values(p_tenant_id,v_quote.id,'analise_recusada',
           'Condições especiais não concedidas: '||p_manager_note,p_manager_id);
    return jsonb_build_object('ok',true,'status','denied');
  end if;

  if p_credit_mode not in ('none','invoice') then raise exception 'INVALID_CREDIT_MODE'; end if;
  if p_additional_discount is null or p_additional_discount<0 then raise exception 'INVALID_DISCOUNT'; end if;
  if round(p_additional_discount,2)<>p_additional_discount then raise exception 'DISCOUNT_CENTS_REQUIRED'; end if;
  v_offer_total=round(v_quote.total-p_additional_discount,2);
  if v_offer_total<5 then raise exception 'MINIMUM_CHECKOUT_AMOUNT'; end if;

  if p_credit_mode='invoice' then
    if v_customer.customer_group::text not in ('revendedor','oficina','distribuidor')
      or v_customer.b2b_status::text<>'approved' then
      raise exception 'CUSTOMER_CREDIT_NOT_APPROVED';
    end if;
    select a.invoice_due_days into v_credit_days
    from public.b2b_customer_price_tables a
    where a.tenant_id=p_tenant_id and a.customer_id=v_customer.id and a.active
      and a.allow_invoice
    for share;
    if not found or v_credit_days is null or v_credit_days<1 or v_credit_days>120 then
      raise exception 'CUSTOMER_CREDIT_NOT_APPROVED';
    end if;
  else
    v_credit_days:=null;
  end if;

  -- A oferta pode expirar; nunca prolonga o prazo do orçamento de origem.
  v_expiry:=least(coalesce(v_quote.valid_until,now()+interval '48 hours'),now()+interval '48 hours');
  if v_expiry<=now() then raise exception 'QUOTE_EXPIRED'; end if;
  select coalesce(max(version),v_quote.version)+1 into v_version
    from public.quotes
    where tenant_id=p_tenant_id and (id=v_quote.id or parent_quote_id=v_quote.id);
  select count(*) into v_item_count from public.quote_items
    where tenant_id=p_tenant_id and quote_id=v_quote.id;
  if v_item_count=0 then raise exception 'QUOTE_WITHOUT_ITEMS'; end if;

  insert into public.quotes(
    tenant_id,customer_id,customer_name,customer_email,customer_phone,
    sales_rep_id,branch_id,origin,status,document_type,title,
    version,parent_quote_id,subtotal,discount,shipping_amount,total,
    valid_until,sent_at,approved_at,created_by,payment_terms,delivery_terms,customer_notes
  ) values (
    p_tenant_id,v_quote.customer_id,v_quote.customer_name,v_quote.customer_email,v_quote.customer_phone,
    v_quote.sales_rep_id,v_quote.branch_id,'site','enviado','proposta',
    'Condições comerciais revisadas — orçamento #'||v_quote.number,
    v_version,v_quote.id,v_quote.subtotal,v_quote.discount+p_additional_discount,
    v_quote.shipping_amount,v_offer_total,v_expiry,now(),now(),p_manager_id,
    case when p_credit_mode='invoice'
      then 'Crédito B2B previamente autorizado: faturamento em '||v_credit_days||' dias'
      else 'PIX, cartão ou boleto conforme condições comerciais do cliente' end,
    v_quote.delivery_terms,nullif(p_manager_note,'')
  ) returning id,number into v_offer_id,v_offer_number;

  insert into public.quote_items(tenant_id,quote_id,product_id,sku,name,qty,unit_price,discount,total,notes)
  select p_tenant_id,v_offer_id,product_id,sku,name,qty,unit_price,discount,total,notes
  from public.quote_items where tenant_id=p_tenant_id and quote_id=v_quote.id;

  update public.quote_commercial_reviews set
    status='offered',additional_discount=p_additional_discount,
    offered_total=v_offer_total,offered_quote_id=v_offer_id,
    credit_mode=p_credit_mode,credit_days=v_credit_days,
    manager_note=nullif(btrim(p_manager_note),''),
    reviewed_by=p_manager_id,reviewed_at=now(),offer_expires_at=v_expiry,updated_at=now()
  where id=v_review.id;

  insert into public.quote_events(tenant_id,quote_id,event_type,note,actor_user_id)
  values(p_tenant_id,v_quote.id,'analise_aprovada',
         'Proposta revisada #'||v_offer_number||' enviada ao cliente.',p_manager_id);
  insert into public.quote_events(tenant_id,quote_id,event_type,note,actor_user_id)
  values(p_tenant_id,v_offer_id,'proposta_enviada',
         'Condição comercial autorizada a partir do orçamento #'||v_quote.number,p_manager_id);

  return jsonb_build_object('ok',true,'status','offered',
    'offer_quote_id',v_offer_id,'offer_number',v_offer_number,
    'offer_total',v_offer_total,'credit_mode',p_credit_mode,'credit_days',v_credit_days);
end
$$;
revoke all on function public.internal_decide_quote_commercial_review(uuid,uuid,uuid,text,numeric,text,text)
  from public,anon,authenticated;
grant execute on function public.internal_decide_quote_commercial_review(uuid,uuid,uuid,text,numeric,text,text)
  to service_role;

commit;
