-- Finalização do bloco de compras: devoluções a fornecedor e divergências formais
begin;

-- Crédito de fornecedor passa a ser um tipo financeiro explícito.
alter table public.financial_receivables
  drop constraint if exists financial_receivables_source_type_check;
alter table public.financial_receivables
  add constraint financial_receivables_source_type_check
  check (source_type in (
    'site_order','payment_intent','b2b_order','pos_payment','core_order','manual','bling_backup','supplier_return'
  ));

create table if not exists public.supplier_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number integer not null default 0,
  supplier_id uuid not null references public.suppliers(id),
  warehouse_id uuid not null,
  goods_receipt_id uuid references public.goods_receipts(id),
  purchase_order_id uuid references public.purchase_orders(id),
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  reason text not null,
  document_number text,
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  notes text,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_returns_warehouse_tenant_fk
    foreign key (warehouse_id, tenant_id) references public.warehouses(id, tenant_id),
  constraint supplier_returns_number_key unique (tenant_id, number)
);

create index if not exists supplier_returns_tenant_status_idx
  on public.supplier_returns(tenant_id,status,created_at desc);
create index if not exists supplier_returns_receipt_idx
  on public.supplier_returns(tenant_id,goods_receipt_id)
  where goods_receipt_id is not null;

create table if not exists public.supplier_return_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_return_id uuid not null references public.supplier_returns(id) on delete cascade,
  product_id uuid not null,
  goods_receipt_item_id uuid references public.goods_receipt_items(id),
  quantity integer not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  reason text,
  created_at timestamptz not null default now(),
  constraint supplier_return_items_product_tenant_fk
    foreign key (product_id, tenant_id) references public.products(id, tenant_id)
);
create index if not exists supplier_return_items_return_idx
  on public.supplier_return_items(tenant_id,supplier_return_id);

create table if not exists public.goods_receipt_discrepancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  goods_receipt_item_id uuid references public.goods_receipt_items(id) on delete cascade,
  type text not null check (type in ('rejected','cost_variance','shortage','overage','damaged','wrong_item','other')),
  status text not null default 'open' check (status in ('open','resolved','waived')),
  expected_value numeric,
  actual_value numeric,
  description text not null,
  resolution_notes text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint goods_receipt_discrepancy_unique unique (goods_receipt_item_id,type)
);
create index if not exists goods_receipt_discrepancies_open_idx
  on public.goods_receipt_discrepancies(tenant_id,status,created_at desc);

alter table public.supplier_returns enable row level security;
alter table public.supplier_return_items enable row level security;
alter table public.goods_receipt_discrepancies enable row level security;

drop policy if exists supplier_returns_select on public.supplier_returns;
create policy supplier_returns_select on public.supplier_returns
for select to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_returns.tenant_id
    and m.user_id=(select auth.uid()) and m.active
));

drop policy if exists supplier_returns_write on public.supplier_returns;
create policy supplier_returns_write on public.supplier_returns
for all to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_returns.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
))
with check (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_returns.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
));

drop policy if exists supplier_return_items_select on public.supplier_return_items;
create policy supplier_return_items_select on public.supplier_return_items
for select to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_return_items.tenant_id
    and m.user_id=(select auth.uid()) and m.active
));

drop policy if exists supplier_return_items_write on public.supplier_return_items;
create policy supplier_return_items_write on public.supplier_return_items
for all to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_return_items.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
))
with check (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=supplier_return_items.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
));

drop policy if exists goods_receipt_discrepancies_select on public.goods_receipt_discrepancies;
create policy goods_receipt_discrepancies_select on public.goods_receipt_discrepancies
for select to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=goods_receipt_discrepancies.tenant_id
    and m.user_id=(select auth.uid()) and m.active
));

drop policy if exists goods_receipt_discrepancies_write on public.goods_receipt_discrepancies;
create policy goods_receipt_discrepancies_write on public.goods_receipt_discrepancies
for update to authenticated
using (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=goods_receipt_discrepancies.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
))
with check (exists (
  select 1 from public.tenant_memberships m
  where m.tenant_id=goods_receipt_discrepancies.tenant_id
    and m.user_id=(select auth.uid()) and m.active
    and m.role in ('owner','admin','manager','stock')
));

grant select,insert,update,delete on public.supplier_returns to authenticated;
grant select,insert,update,delete on public.supplier_return_items to authenticated;
grant select,update on public.goods_receipt_discrepancies to authenticated;
grant all on public.supplier_returns, public.supplier_return_items, public.goods_receipt_discrepancies to service_role;
revoke all on public.supplier_returns, public.supplier_return_items, public.goods_receipt_discrepancies from anon;

create or replace function public.assign_supplier_return_number()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if new.number=0 then
    perform pg_advisory_xact_lock(hashtext(new.tenant_id::text || ':supplier_returns'));
    select coalesce(max(r.number),0)+1 into new.number
    from public.supplier_returns r where r.tenant_id=new.tenant_id;
  end if;
  new.updated_at=now();
  return new;
end;
$$;
drop trigger if exists supplier_returns_assign_number on public.supplier_returns;
create trigger supplier_returns_assign_number
before insert on public.supplier_returns
for each row execute function public.assign_supplier_return_number();

create or replace function public.collect_receipt_discrepancies()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_item record;
begin
  if new.status='confirmed' and old.status is distinct from 'confirmed' then
    for v_item in
      select gri.id, gri.tenant_id, gri.rejected_qty, gri.unit_cost,
             poi.unit_cost as ordered_unit_cost
      from public.goods_receipt_items gri
      left join public.purchase_order_items poi on poi.id=gri.purchase_order_item_id
      where gri.goods_receipt_id=new.id
    loop
      if coalesce(v_item.rejected_qty,0)>0 then
        insert into public.goods_receipt_discrepancies(
          tenant_id,goods_receipt_id,goods_receipt_item_id,type,expected_value,actual_value,description
        ) values (
          v_item.tenant_id,new.id,v_item.id,'rejected',0,v_item.rejected_qty,
          'Quantidade rejeitada durante a conferência do recebimento'
        ) on conflict (goods_receipt_item_id,type) do nothing;
      end if;
      if v_item.ordered_unit_cost is not null
         and abs(coalesce(v_item.unit_cost,0)-coalesce(v_item.ordered_unit_cost,0)) >= 0.01 then
        insert into public.goods_receipt_discrepancies(
          tenant_id,goods_receipt_id,goods_receipt_item_id,type,expected_value,actual_value,description
        ) values (
          v_item.tenant_id,new.id,v_item.id,'cost_variance',v_item.ordered_unit_cost,v_item.unit_cost,
          'Custo recebido diverge do custo aprovado no pedido de compra'
        ) on conflict (goods_receipt_item_id,type) do nothing;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.collect_receipt_discrepancies() from public,anon,authenticated;
grant execute on function public.collect_receipt_discrepancies() to service_role;
drop trigger if exists goods_receipts_collect_discrepancies on public.goods_receipts;
create trigger goods_receipts_collect_discrepancies
after update of status on public.goods_receipts
for each row execute function public.collect_receipt_discrepancies();

create or replace function public.confirm_supplier_return(
  p_return_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_return public.supplier_returns;
  v_item record;
  v_stock public.product_stock;
  v_supplier_name text;
  v_total numeric:=0;
  v_expense public.expenses;
  v_credit numeric:=0;
  v_reduce numeric:=0;
  v_new_amount numeric:=0;
begin
  select * into v_return from public.supplier_returns where id=p_return_id for update;
  if v_return.id is null then raise exception 'Devolução não encontrada'; end if;
  if not exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id=v_return.tenant_id and m.user_id=p_actor_user_id and m.active
      and m.role in ('owner','admin','manager','stock')
  ) then raise exception 'Usuário sem permissão para confirmar devolução'; end if;
  if v_return.status='confirmed' then
    return jsonb_build_object('ok',true,'already_confirmed',true,'id',v_return.id,'total',v_return.total_amount);
  end if;
  if v_return.status<>'draft' then raise exception 'Somente devolução em rascunho pode ser confirmada'; end if;

  select legal_name into v_supplier_name from public.suppliers
  where id=v_return.supplier_id and tenant_id=v_return.tenant_id;

  if not exists(select 1 from public.supplier_return_items where supplier_return_id=v_return.id) then
    raise exception 'Inclua ao menos um item na devolução';
  end if;

  for v_item in
    select * from public.supplier_return_items where supplier_return_id=v_return.id order by id
  loop
    select * into v_stock from public.product_stock
    where tenant_id=v_return.tenant_id
      and warehouse_id=v_return.warehouse_id
      and product_id=v_item.product_id
    for update;
    if v_stock.id is null or (v_stock.on_hand-v_stock.reserved)<v_item.quantity then
      raise exception 'Estoque disponível insuficiente para devolver o produto %',v_item.product_id;
    end if;

    update public.product_stock
      set on_hand=on_hand-v_item.quantity, updated_at=now()
    where id=v_stock.id;

    insert into public.stock_movements(
      tenant_id,product_id,warehouse_id,type,qty,reference,notes,user_id
    ) values (
      v_return.tenant_id,v_item.product_id,v_return.warehouse_id,'OUT',v_item.quantity,
      'supplier_return:'||v_return.id::text,
      'Devolução ao fornecedor #'||v_return.number::text,p_actor_user_id
    );
    v_total:=v_total+v_item.line_total;
  end loop;

  update public.supplier_returns
    set total_amount=round(v_total,2),status='confirmed',confirmed_at=now(),
        confirmed_by=p_actor_user_id,updated_by=p_actor_user_id,updated_at=now()
  where id=v_return.id;

  if v_return.goods_receipt_id is not null then
    select * into v_expense from public.expenses
    where tenant_id=v_return.tenant_id and goods_receipt_id=v_return.goods_receipt_id
    order by created_at desc limit 1 for update;
  end if;

  v_credit:=round(v_total,2);
  if v_expense.id is not null and v_credit>0 then
    v_reduce:=least(v_credit,greatest(v_expense.amount-v_expense.paid_amount,0));
    if v_reduce>0 then
      v_new_amount:=v_expense.amount-v_reduce;
      update public.expenses
        set amount=v_new_amount,
            status=case when v_new_amount<=v_expense.paid_amount then
              case when v_expense.paid_amount>0 then 'paid' else 'canceled' end
              else status end,
            notes=concat_ws(E'\n',notes,'Crédito por devolução ao fornecedor #'||v_return.number::text||': R$ '||to_char(v_reduce,'FM999999990.00')),
            updated_by=p_actor_user_id,updated_at=now()
      where id=v_expense.id;
      v_credit:=v_credit-v_reduce;
    end if;
  end if;

  if v_credit>0 then
    insert into public.financial_receivables(
      tenant_id,source_type,source_id,customer_name,description,amount,due_date,
      payment_method,payment_reference,status,notes,created_by,updated_by
    ) values (
      v_return.tenant_id,'supplier_return',v_return.id,coalesce(v_supplier_name,'Fornecedor'),
      'Crédito de devolução ao fornecedor #'||v_return.number::text,
      v_credit,current_date,'compensacao_fornecedor',v_return.document_number,'open',
      'Crédito remanescente após compensação de contas a pagar',p_actor_user_id,p_actor_user_id
    )
    on conflict (tenant_id,source_type,source_id) do update
      set amount=excluded.amount,updated_by=excluded.updated_by,updated_at=now();
  end if;

  insert into public.audit_events(
    organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data,metadata
  )
  select t.organization_id,v_return.tenant_id,p_actor_user_id,'supplier_return.confirmed','supplier_return',
         v_return.id::text,
         jsonb_build_object('status','confirmed','total_amount',round(v_total,2)),
         jsonb_build_object('goods_receipt_id',v_return.goods_receipt_id,'purchase_order_id',v_return.purchase_order_id)
  from public.tenants t where t.id=v_return.tenant_id;

  return jsonb_build_object('ok',true,'already_confirmed',false,'id',v_return.id,'total',round(v_total,2),'credit_receivable',v_credit);
end;
$$;
revoke all on function public.confirm_supplier_return(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_supplier_return(uuid,uuid) to service_role;

commit;
