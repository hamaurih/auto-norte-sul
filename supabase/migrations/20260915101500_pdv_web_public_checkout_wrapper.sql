-- PDV web: expose the hardened checkout through the RPC name used by the server function.
-- Repeated requests with the same key return the original sale safely.
create or replace function public.finalize_pos_sale(
  p_tenant_id uuid,
  p_cash_session_id uuid,
  p_idempotency_key uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount_amount numeric default 0,
  p_customer_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_existing uuid;
begin
  select id into v_existing
  from public.pos_sales
  where tenant_id = p_tenant_id
    and idempotency_key = p_idempotency_key
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  return private.finalize_pos_sale(
    p_tenant_id,
    p_cash_session_id,
    p_idempotency_key,
    p_items,
    p_payments,
    p_discount_amount,
    p_customer_id
  );
end;
$function$;

revoke all on function public.finalize_pos_sale(uuid, uuid, uuid, jsonb, jsonb, numeric, uuid) from public, anon;
grant execute on function public.finalize_pos_sale(uuid, uuid, uuid, jsonb, jsonb, numeric, uuid) to authenticated;
