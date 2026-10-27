begin;

create table if not exists public.purchase_quotations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number integer not null default 0,
  warehouse_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft','open','awarded','converted','cancelled')),
  title text not null,
  requested_by_date date,
  notes text,
  selected_supplier_quote_id uuid,
  purchase_order_id uuid references public.purchase_orders(id),
  converted_at timestamptz,
  converted_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_quotations_warehouse_tenant_fk
    foreign key (warehouse_id,tenant_id) references public.warehouses(id,tenant_id),
  constraint purchase_quotations_number_key unique (tenant_id,number)
);

create table if not exists public.purchase_quotation_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quotation_id uuid not null references public.purchase_quotations(id) on delete cascade,
  product_id uuid not null,
  requested_qty numeric(14,4) not null check (requested_qty > 0),
  notes text,
  created_at timestamptz not null default now(),
  constraint purchase_quotation_items_product_tenant_fk
    foreign key (product_id,tenant_id) references public.products(id,tenant_id),
  constraint purchase_quotation_items_unique unique (quotation_id,product_id)
);

create table if not exists public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quotation_id uuid not null references public.purchase_quotations(id) on delete cascade,
  supplier_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft','submitted','selected','rejected')),
  payment_terms text,
  delivery_days integer check (delivery_days is null or delivery_days >= 0),
  freight_amount numeric(14,2) not null default 0 check (freight_amount >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  other_amount numeric(14,2) not null default 0 check (other_amount >= 0),
  items_total numeric(14,2) not null default 0 check (items_total >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  valid_until date,
  notes text,
  submitted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_quotes_unique_supplier unique (quotation_id,supplier_id),
  constraint supplier_quotes_supplier_tenant_fkey
    foreign key (supplier_id,tenant_id) references public.suppliers(id,tenant_id)
);

create table if not exists public.supplier_quote_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_quote_id uuid not null references public.supplier_quotes(id) on delete cascade,
  quotation_item_id uuid not null references public.purchase_quotation_items(id) on delete cascade,
  product_id uuid not null,
  offered_qty numeric(14,4) not null check (offered_qty >= 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  notes text,
  created_at timestamptz not null default now(),
  constraint supplier_quote_items_product_tenant_fk
    foreign key (product_id,tenant_id) references public.products(id,tenant_id),
  constraint supplier_quote_items_unique unique (supplier_quote_id,quotation_item_id)
);

alter table public.purchase_quotations
  add constraint purchase_quotations_selected_quote_fkey
  foreign key (selected_supplier_quote_id) references public.supplier_quotes(id);

create index if not exists purchase_quotations_tenant_status_idx on public.purchase_quotations(tenant_id,status,created_at desc);
create index if not exists purchase_quotation_items_quote_idx on public.purchase_quotation_items(tenant_id,quotation_id);
create index if not exists supplier_quotes_quote_idx on public.supplier_quotes(tenant_id,quotation_id,status);
create index if not exists supplier_quotes_supplier_idx on public.supplier_quotes(tenant_id,supplier_id);
create index if not exists supplier_quote_items_quote_idx on public.supplier_quote_items(tenant_id,supplier_quote_id);

alter table public.purchase_quotations enable row level security;
alter table public.purchase_quotation_items enable row level security;
alter table public.supplier_quotes enable row level security;
alter table public.supplier_quote_items enable row level security;

create policy purchase_quotations_select on public.purchase_quotations
for select to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotations.tenant_id
  and m.user_id=(select auth.uid()) and m.active
));
create policy purchase_quotations_insert on public.purchase_quotations
for insert to authenticated with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotations.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy purchase_quotations_update on public.purchase_quotations
for update to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotations.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
)) with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotations.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));

create policy purchase_quotation_items_select on public.purchase_quotation_items
for select to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotation_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active
));
create policy purchase_quotation_items_insert on public.purchase_quotation_items
for insert to authenticated with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotation_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy purchase_quotation_items_update on public.purchase_quotation_items
for update to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotation_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
)) with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotation_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy purchase_quotation_items_delete on public.purchase_quotation_items
for delete to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=purchase_quotation_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));

create policy supplier_quotes_select on public.supplier_quotes
for select to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quotes.tenant_id
  and m.user_id=(select auth.uid()) and m.active
));
create policy supplier_quotes_insert on public.supplier_quotes
for insert to authenticated with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quotes.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy supplier_quotes_update on public.supplier_quotes
for update to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quotes.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
)) with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quotes.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy supplier_quotes_delete on public.supplier_quotes
for delete to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quotes.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));

create policy supplier_quote_items_select on public.supplier_quote_items
for select to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quote_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active
));
create policy supplier_quote_items_insert on public.supplier_quote_items
for insert to authenticated with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quote_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy supplier_quote_items_update on public.supplier_quote_items
for update to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quote_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
)) with check (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quote_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));
create policy supplier_quote_items_delete on public.supplier_quote_items
for delete to authenticated using (exists(
  select 1 from public.tenant_memberships m where m.tenant_id=supplier_quote_items.tenant_id
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','manager','stock')
));

grant select,insert,update,delete on public.purchase_quotations,public.purchase_quotation_items,public.supplier_quotes,public.supplier_quote_items to authenticated;
grant all on public.purchase_quotations,public.purchase_quotation_items,public.supplier_quotes,public.supplier_quote_items to service_role;
revoke all on public.purchase_quotations,public.purchase_quotation_items,public.supplier_quotes,public.supplier_quote_items from anon;

create or replace function public.assign_purchase_quotation_number()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.number=0 then
    perform pg_advisory_xact_lock(hashtext(new.tenant_id::text||':purchase_quotations'));
    select coalesce(max(q.number),0)+1 into new.number
      from public.purchase_quotations q where q.tenant_id=new.tenant_id;
  end if;
  new.updated_at=now();
  return new;
end $$;

create trigger purchase_quotations_number
before insert on public.purchase_quotations
for each row execute function public.assign_purchase_quotation_number();

create or replace function public.convert_supplier_quote_to_purchase_order(
  p_supplier_quote_id uuid,
  p_actor_user_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_quote public.supplier_quotes;
  v_quotation public.purchase_quotations;
  v_order_id uuid;
  v_order_number integer;
  v_missing integer;
begin
  select * into v_quote from public.supplier_quotes where id=p_supplier_quote_id for update;
  if v_quote.id is null then raise exception 'Proposta não encontrada'; end if;

  select * into v_quotation from public.purchase_quotations where id=v_quote.quotation_id for update;
  if v_quotation.id is null then raise exception 'Cotação não encontrada'; end if;

  if not exists(
    select 1 from public.tenant_memberships m
    where m.tenant_id=v_quote.tenant_id and m.user_id=p_actor_user_id and m.active
      and m.role in ('owner','admin','manager')
  ) then raise exception 'Usuário sem permissão para selecionar proposta'; end if;

  if v_quotation.status='converted' then
    return jsonb_build_object('ok',true,'already_converted',true,'purchase_order_id',v_quotation.purchase_order_id);
  end if;
  if v_quote.status not in ('submitted','selected') then raise exception 'A proposta precisa estar enviada'; end if;

  select count(*) into v_missing
  from public.purchase_quotation_items qi
  left join public.supplier_quote_items si
    on si.quotation_item_id=qi.id and si.supplier_quote_id=v_quote.id
  where qi.quotation_id=v_quotation.id
    and (si.id is null or si.offered_qty < qi.requested_qty or si.unit_cost < 0);

  if v_missing>0 then raise exception 'A proposta não atende integralmente os itens da cotação'; end if;

  insert into public.purchase_orders(
    tenant_id,supplier_id,warehouse_id,status,issued_at,expected_at,payment_terms,
    freight_amount,discount_amount,other_amount,items_total,total_amount,notes,created_by,updated_by
  ) values (
    v_quote.tenant_id,v_quote.supplier_id,v_quotation.warehouse_id,'draft',current_date,
    case when v_quote.delivery_days is null then null else current_date+v_quote.delivery_days end,
    v_quote.payment_terms,v_quote.freight_amount,v_quote.discount_amount,v_quote.other_amount,
    v_quote.items_total,v_quote.total_amount,
    'Gerado da cotação #'||v_quotation.number::text,p_actor_user_id,p_actor_user_id
  ) returning id,number into v_order_id,v_order_number;

  insert into public.purchase_order_items(
    tenant_id,purchase_order_id,product_id,ordered_qty,unit_cost,discount_amount,tax_amount,line_total,notes
  )
  select v_quote.tenant_id,v_order_id,qi.product_id,qi.requested_qty,si.unit_cost,0,0,
         round(qi.requested_qty*si.unit_cost,2),si.notes
  from public.purchase_quotation_items qi
  join public.supplier_quote_items si on si.quotation_item_id=qi.id and si.supplier_quote_id=v_quote.id
  where qi.quotation_id=v_quotation.id;

  update public.supplier_quotes
    set status=case when id=v_quote.id then 'selected' else 'rejected' end,
        updated_by=p_actor_user_id,updated_at=now()
  where quotation_id=v_quotation.id;

  update public.purchase_quotations
    set status='converted',selected_supplier_quote_id=v_quote.id,purchase_order_id=v_order_id,
        converted_at=now(),converted_by=p_actor_user_id,updated_by=p_actor_user_id,updated_at=now()
  where id=v_quotation.id;

  insert into public.audit_events(
    organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data,metadata
  )
  select t.organization_id,v_quote.tenant_id,p_actor_user_id,'purchase_quotation.converted',
         'purchase_quotation',v_quotation.id::text,
         jsonb_build_object('status','converted','purchase_order_id',v_order_id,'supplier_quote_id',v_quote.id),
         jsonb_build_object('purchase_order_number',v_order_number,'supplier_id',v_quote.supplier_id)
  from public.tenants t where t.id=v_quote.tenant_id;

  return jsonb_build_object('ok',true,'already_converted',false,'purchase_order_id',v_order_id,'purchase_order_number',v_order_number);
end $$;

revoke all on function public.convert_supplier_quote_to_purchase_order(uuid,uuid) from public,anon,authenticated;
grant execute on function public.convert_supplier_quote_to_purchase_order(uuid,uuid) to service_role;

commit;