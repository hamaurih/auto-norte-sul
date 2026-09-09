-- Corrige o salvamento de produto sem reabrir helpers privados de preço.
-- O trigger executa como definer (postgres), enquanto compute/apply continuam sem EXECUTE para anon/authenticated.

create or replace function private.sync_b2c_from_b2b()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_auto boolean := true;
begin
  if coalesce(new.price_b2b,0) <= 0 and coalesce(new.price_b2c,0) > 0 then
    new.price_b2b := new.price_b2c;
  end if;

  select auto_recalculate_b2c
    into v_auto
  from public.tenant_pricing_settings
  where tenant_id = new.tenant_id;

  if coalesce(v_auto,true) then
    new.price_b2c := private.compute_b2c_price(
      new.tenant_id,
      new.id,
      coalesce(new.price_b2b,0)
    );
  end if;

  return new;
end;
$$;

revoke all on function private.sync_b2c_from_b2b() from public, anon, authenticated;
