begin;

do $integrity$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'goods_receipt_items_conversion_integrity_check'
      and conrelid = 'public.goods_receipt_items'::regclass
  ) then
    alter table public.goods_receipt_items
      add constraint goods_receipt_items_conversion_integrity_check
      check (
        accepted_qty >= 0
        and rejected_qty >= 0
        and accepted_qty =
          (received_package_qty - rejected_package_qty) * units_per_package
        and rejected_qty = rejected_package_qty * units_per_package
      );
  end if;
end;
$integrity$;

comment on constraint goods_receipt_items_conversion_integrity_check
  on public.goods_receipt_items is
  'Mantém as unidades-base aceitas/recusadas sincronizadas com a quantidade física da embalagem.';

notify pgrst, 'reload schema';

commit;
