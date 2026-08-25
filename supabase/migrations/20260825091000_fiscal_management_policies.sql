begin;
grant insert,update on public.fiscal_settings to authenticated;
grant insert,update on public.product_fiscal_profiles to authenticated;

drop policy if exists fiscal_settings_insert_admin on public.fiscal_settings;
create policy fiscal_settings_insert_admin on public.fiscal_settings for insert to authenticated
with check((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
drop policy if exists fiscal_settings_update_admin on public.fiscal_settings;
create policy fiscal_settings_update_admin on public.fiscal_settings for update to authenticated
using((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])))
with check((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));

drop policy if exists product_fiscal_profiles_insert_admin on public.product_fiscal_profiles;
create policy product_fiscal_profiles_insert_admin on public.product_fiscal_profiles for insert to authenticated
with check((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
drop policy if exists product_fiscal_profiles_update_admin on public.product_fiscal_profiles;
create policy product_fiscal_profiles_update_admin on public.product_fiscal_profiles for update to authenticated
using((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])))
with check((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
commit;