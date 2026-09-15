begin;

alter table public.expenses
  add column if not exists supplier_id uuid references public.suppliers(id),
  add column if not exists purchase_order_id uuid references public.purchase_orders(id),
  add column if not exists goods_receipt_id uuid references public.goods_receipts(id);

create unique index if not exists expenses_goods_receipt_unique
  on public.expenses(tenant_id, goods_receipt_id)
  where goods_receipt_id is not null;

create or replace function private.create_payable_from_goods_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric(14,2);
  v_supplier text;
  v_due date;
  v_user uuid := auth.uid();
begin
  if new.status <> 'confirmed' or old.status = 'confirmed' then
    return new;
  end if;

  select coalesce(sum(ri.accepted_qty * ri.unit_cost), 0)
         + new.freight_amount + new.insurance_amount + new.other_amount
         - new.discount_amount
    into v_amount
    from public.goods_receipt_items ri
   where ri.goods_receipt_id = new.id;

  if v_amount <= 0 then
    return new;
  end if;

  select coalesce(s.trade_name, s.legal_name)
    into v_supplier
    from public.suppliers s
   where s.id = new.supplier_id
     and s.tenant_id = new.tenant_id;

  v_due := new.received_at;

  insert into public.expenses (
    tenant_id, description, kind, status, amount, competence_date, due_date,
    supplier_name, document_number, notes, source_type, source_id,
    supplier_id, purchase_order_id, goods_receipt_id, created_by, updated_by
  )
  values (
    new.tenant_id,
    'Entrada de mercadoria #' || new.number::text,
    'variable',
    'open',
    v_amount,
    new.received_at,
    v_due,
    v_supplier,
    new.invoice_number,
    'Gerado automaticamente pela confirmação do recebimento.',
    'goods_receipt',
    new.id,
    new.supplier_id,
    new.purchase_order_id,
    new.id,
    coalesce(v_user, new.confirmed_by),
    coalesce(v_user, new.confirmed_by)
  )
  on conflict (tenant_id, goods_receipt_id) where goods_receipt_id is not null
  do update set amount = excluded.amount,
                supplier_name = excluded.supplier_name,
                document_number = excluded.document_number,
                updated_by = excluded.updated_by,
                updated_at = now();

  return new;
end;
$$;

drop trigger if exists goods_receipt_create_payable on public.goods_receipts;
create trigger goods_receipt_create_payable
after update of status on public.goods_receipts
for each row execute function private.create_payable_from_goods_receipt();

create index if not exists expenses_tenant_due_status_idx
  on public.expenses(tenant_id, due_date, status);

revoke all on function private.create_payable_from_goods_receipt() from public, anon;
grant execute on function private.create_payable_from_goods_receipt() to authenticated, service_role;

commit;