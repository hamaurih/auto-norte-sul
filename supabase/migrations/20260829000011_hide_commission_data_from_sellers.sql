-- Commission rates and generated commission values are management data.
-- Sellers may keep access to their operational discount limit, but never to commission_pct.
drop policy if exists seller_commission_periods_read on public.seller_commission_periods;

create policy seller_commission_periods_read
  on public.seller_commission_periods
  for select
  to authenticated
  using (
    private.has_tenant_role(
      tenant_id,
      array['owner', 'admin', 'manager']::text[]
    )
  );

-- Remove broad table-level SELECT and grant only non-sensitive seller fields.
-- Managers/admins read commission_pct through the server-side management function,
-- which verifies the role before using the service-role client.
revoke select on table public.sales_reps from anon, authenticated;

grant select (
  id,
  user_id,
  full_name,
  email,
  phone,
  active,
  max_discount_pct,
  can_sell_b2b,
  can_create_customer,
  tenant_id,
  invited_by,
  invited_at,
  activated_at,
  created_at,
  updated_at
) on table public.sales_reps to authenticated;

revoke select (commission_pct) on table public.sales_reps from anon, authenticated;

comment on column public.sales_reps.commission_pct is
  'Dado gerencial. Nunca expor diretamente ao vendedor; usar função de servidor protegida para administradores/gerentes.';

notify pgrst, 'reload schema';
