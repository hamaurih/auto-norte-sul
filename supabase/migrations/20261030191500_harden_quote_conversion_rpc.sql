begin;

revoke all on function public.convert_my_quote_to_storefront_order(uuid,text)
from public,anon,authenticated;
grant execute on function public.convert_my_quote_to_storefront_order(uuid,text)
to service_role;

create or replace function public.internal_convert_my_quote_to_storefront_order(
  p_user_id uuid,
  p_quote_id uuid,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',p_user_id::text,'role','authenticated')::text,
    true
  );
  return public.convert_my_quote_to_storefront_order(p_quote_id,p_payment_method);
end
$$;

revoke all on function public.internal_convert_my_quote_to_storefront_order(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.internal_convert_my_quote_to_storefront_order(uuid,uuid,text)
to service_role;

commit;