-- P0.5 PDV: confirmação de estorno Stone antes de devolver estoque.
-- O terminal chama a Stone primeiro; somente um gestor autenticado pode registrar
-- no ERP que aquele pagamento Stone foi efetivamente revertido.

create or replace function private.confirm_pos_payment_reversal(
  p_payment_id uuid,
  p_provider_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_payment public.pos_payments;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payment_id is null then raise exception 'PAYMENT_REQUIRED'; end if;

  select *
    into v_payment
  from public.pos_payments
  where id = p_payment_id
  for update;

  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  if not exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = v_payment.tenant_id
      and tm.user_id = v_user
      and tm.active
      and tm.role in ('owner','admin','manager')
  ) then
    raise exception 'PAYMENT_REVERSAL_REQUIRES_MANAGER';
  end if;

  if coalesce(v_payment.provider, '') <> 'stone' then
    raise exception 'STONE_PAYMENT_REQUIRED';
  end if;

  if v_payment.status = 'refunded' then
    return v_payment.id;
  end if;

  if v_payment.status <> 'confirmed' then
    raise exception 'PAYMENT_NOT_REVERSIBLE';
  end if;

  if v_payment.provider_reference is null
     or pg_catalog.btrim(v_payment.provider_reference) = '' then
    raise exception 'STONE_ATK_REQUIRED';
  end if;

  if pg_catalog.btrim(coalesce(p_provider_reference, '')) <> pg_catalog.btrim(v_payment.provider_reference) then
    raise exception 'PAYMENT_REFERENCE_MISMATCH';
  end if;

  update public.pos_payments
  set status = 'refunded'
  where id = v_payment.id
    and status = 'confirmed';

  return v_payment.id;
end
$function$;

revoke all on function private.confirm_pos_payment_reversal(uuid, text)
  from public, anon;
grant execute on function private.confirm_pos_payment_reversal(uuid, text)
  to authenticated, service_role;

create or replace function public.confirm_pos_payment_reversal(
  p_payment_id uuid,
  p_provider_reference text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $wrapper$
  select private.confirm_pos_payment_reversal($1, $2);
$wrapper$;

revoke all on function public.confirm_pos_payment_reversal(uuid, text)
  from public, anon;
grant execute on function public.confirm_pos_payment_reversal(uuid, text)
  to authenticated, service_role;

comment on function public.confirm_pos_payment_reversal(uuid, text)
is 'Marca pagamento Stone como estornado após retorno positivo do SmartPOS; exige owner/admin/manager.';

notify pgrst, 'reload schema';
