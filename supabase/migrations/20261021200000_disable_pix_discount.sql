-- Elimina desconto automático de 5% para novas vendas PIX.
-- Preserva integralmente transações já pagas e descontos B2B regulares.
create or replace function public.internal_create_storefront_order(
 p_user_id uuid,p_tenant_slug text,p_customer jsonb,p_items jsonb,
 p_payment_method text,p_idempotency_key uuid)
returns uuid language plpgsql set search_path='' as $body$
declare v_order_id uuid; v_tenant_id uuid;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required'; end if;
 perform set_config('request.jwt.claim.sub',p_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','authenticated')::text,true);
 perform set_config('request.headers',jsonb_build_object('x-tenant-slug',p_tenant_slug)::text,true);
 v_tenant_id:=private.requested_storefront_tenant_id();
 if v_tenant_id is null then raise exception 'tenant storefront inválido';end if;
 v_order_id:=private.create_storefront_order(p_customer,p_items,p_payment_method,p_idempotency_key);
 -- PIX tem o mesmo preço das demais formas de pagamento. Não alterar pedido existente.
 return v_order_id;
end
$body$;
