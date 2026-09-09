-- Tenant members must be able to resolve the tenant they belong to.
-- Previously this policy only accepted organization memberships, so a direct
-- tenant admin could authenticate successfully but my_access_context() returned
-- no tenant and the UI redirected the user to /ativacao.
drop policy if exists tenants_select_members on public.tenants;

create policy tenants_select_members
on public.tenants
for select
to authenticated
using (
  private.has_organization_role(organization_id)
  or private.has_tenant_role(id)
);
