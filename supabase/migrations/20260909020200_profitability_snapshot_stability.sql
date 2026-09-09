-- Preserva a fotografia do custo histórico depois que o item foi criado.
create or replace function private.snapshot_order_item_profitability()
returns trigger language plpgsql set search_path='' as $$
declare
  v_tenant uuid;
  v_variable_pct numeric := 0;
  v_cost numeric := 0;
  v_unit_price numeric := 0;
  v_contribution numeric := 0;
begin
  select tenant_id, coalesce(channel_variable_cost_pct_snapshot,0)
    into v_tenant, v_variable_pct
  from public.orders where id=new.order_id;

  if v_tenant is null then return new; end if;
  if new.tenant_id is null then new.tenant_id := v_tenant; end if;

  if new.product_id is not null then
    if tg_op='INSERT' or new.unit_cost_snapshot is null or new.product_id is distinct from old.product_id then
      new.unit_cost_snapshot := private.product_effective_cost(v_tenant,new.product_id);
    end if;
    v_cost := coalesce(new.unit_cost_snapshot,0);
  else
    v_cost := coalesce(new.unit_cost_snapshot,0);
  end if;

  v_unit_price := coalesce(new.unit_price,0);
  v_contribution := v_unit_price - v_cost - (v_unit_price*v_variable_pct/100);
  new.contribution_margin_amount := round(v_contribution,4);
  new.contribution_margin_pct := case when v_unit_price>0 then round((v_contribution/v_unit_price)*100,4) else 0 end;
  return new;
end;
$$;
revoke all on function private.snapshot_order_item_profitability() from public, anon, authenticated;
