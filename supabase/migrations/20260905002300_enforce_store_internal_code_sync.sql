-- Proteção permanente: SKU Norte Sul com prefixo AZ-/F- sempre mantém
-- internal_code igual ao código da loja, normalizado, sem tocar no código do fabricante.

create or replace function private.sync_store_internal_code()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_sku text;
begin
  if new.sku is null then return new; end if;

  v_sku := upper(regexp_replace(replace(btrim(new.sku), '\t',''), '[[:space:]]+', '', 'g'));
  if v_sku ~ '^(AZ|F)-' then
    new.sku := v_sku;
    new.internal_code := v_sku;
  end if;
  return new;
end;
$function$;

revoke all on function private.sync_store_internal_code() from public, anon, authenticated;

drop trigger if exists trg_sync_store_internal_code on public.products;
create trigger trg_sync_store_internal_code
before insert or update of sku, internal_code on public.products
for each row execute function private.sync_store_internal_code();
