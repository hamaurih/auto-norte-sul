-- Preserve current staff access while replacing global roles with tenant-scoped roles.
insert into public.tenant_memberships (tenant_id, user_id, role, active)
select
  tenant.id,
  legacy.user_id,
  case legacy.role::text
    when 'admin' then 'admin'
    when 'gerente' then 'manager'
    when 'vendedor' then 'sales'
  end,
  true
from public.user_roles legacy
join public.tenants tenant on tenant.environment = 'production'
join public.organizations organization
  on organization.id = tenant.organization_id
 and organization.slug = 'norte-sul-acessorios'
where legacy.role::text in ('admin', 'gerente', 'vendedor')
on conflict (tenant_id, user_id) do update
set role = excluded.role,
    active = true,
    updated_at = now();
