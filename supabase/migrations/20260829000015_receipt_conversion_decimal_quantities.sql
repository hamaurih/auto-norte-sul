begin;

alter table public.goods_receipt_items
  drop constraint if exists goods_receipt_items_received_package_qty_check,
  drop constraint if exists goods_receipt_items_rejected_package_qty_check;

alter table public.goods_receipt_items
  add constraint goods_receipt_items_received_package_qty_check
  check (received_package_qty >= 0);

alter table public.goods_receipt_items
  add constraint goods_receipt_items_rejected_package_qty_check
  check (
    rejected_package_qty >= 0
    and rejected_package_qty <= received_package_qty
  );

comment on constraint goods_receipt_items_received_package_qty_check
  on public.goods_receipt_items is
  'Quantidade física recebida na unidade de entrada; aceita frações para itens vendidos por peso ou volume.';

comment on constraint goods_receipt_items_rejected_package_qty_check
  on public.goods_receipt_items is
  'Quantidade física recusada não pode superar a quantidade recebida.';

notify pgrst, 'reload schema';

commit;
