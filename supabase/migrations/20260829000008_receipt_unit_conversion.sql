begin;

alter table public.goods_receipt_items
  add column if not exists received_package_qty numeric not null default 0,
  add column if not exists rejected_package_qty numeric not null default 0,
  add column if not exists units_per_package numeric not null default 1,
  add column if not exists package_unit text not null default 'UN';

update public.goods_receipt_items
set received_package_qty = accepted_qty + rejected_qty,
    rejected_package_qty = rejected_qty,
    units_per_package = 1,
    package_unit = 'UN'
where received_package_qty = 0
  and (accepted_qty > 0 or rejected_qty > 0);

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goods_receipt_items_received_package_qty_check'
  ) then
    alter table public.goods_receipt_items
      add constraint goods_receipt_items_received_package_qty_check
      check (
        received_package_qty >= 0
        and received_package_qty = trunc(received_package_qty)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'goods_receipt_items_rejected_package_qty_check'
  ) then
    alter table public.goods_receipt_items
      add constraint goods_receipt_items_rejected_package_qty_check
      check (
        rejected_package_qty >= 0
        and rejected_package_qty <= received_package_qty
        and rejected_package_qty = trunc(rejected_package_qty)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'goods_receipt_items_units_per_package_check'
  ) then
    alter table public.goods_receipt_items
      add constraint goods_receipt_items_units_per_package_check
      check (
        units_per_package > 0
        and units_per_package = trunc(units_per_package)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'goods_receipt_items_package_unit_check'
  ) then
    alter table public.goods_receipt_items
      add constraint goods_receipt_items_package_unit_check
      check (package_unit ~ '^[A-Z][A-Z0-9_]{0,9}$');
  end if;
end;
$constraints$;

comment on column public.goods_receipt_items.received_package_qty is
  'Quantidade física recebida na unidade informada em package_unit.';
comment on column public.goods_receipt_items.rejected_package_qty is
  'Quantidade física recusada na unidade informada em package_unit.';
comment on column public.goods_receipt_items.units_per_package is
  'Fator de conversão da unidade de entrada para a unidade-base do estoque.';
comment on column public.goods_receipt_items.package_unit is
  'Unidade de entrada da embalagem, por exemplo CX, FD, KIT ou UN.';

notify pgrst, 'reload schema';

commit;
