-- Development bootstrap for the Norte Sul client-zero account.
-- No users or operational data are created here.

insert into public.organizations (slug, legal_name, trade_name, status)
values ('norte-sul-acessorios', 'Norte Sul Acessórios', 'Norte Sul Acessórios', 'active')
on conflict (slug) do update
set trade_name = excluded.trade_name,
    status = excluded.status,
    updated_at = now();

insert into public.tenants (organization_id, name, slug, environment, status)
select id, 'Norte Sul — Operação Real', 'norte-sul-real', 'production', 'active'
from public.organizations
where slug = 'norte-sul-acessorios'
on conflict (organization_id, environment) do update
set name = excluded.name,
    slug = excluded.slug,
    status = excluded.status,
    updated_at = now();

insert into public.tenants (organization_id, name, slug, environment, status)
select id, 'Norte Sul — Demonstração', 'norte-sul-demo', 'demo', 'active'
from public.organizations
where slug = 'norte-sul-acessorios'
on conflict (organization_id, environment) do update
set name = excluded.name,
    slug = excluded.slug,
    status = excluded.status,
    updated_at = now();

-- The demo tenant exposes every planned module for guided evaluation.
insert into public.tenant_modules (tenant_id, module_key, enabled)
select tenant.id, module.module_key, true
from public.tenants tenant
cross join unnest(array[
  'catalog', 'sales', 'pos', 'inventory', 'purchasing', 'finance',
  'fiscal', 'crm', 'ecommerce', 'ai', 'reports', 'integrations'
]) as module(module_key)
where tenant.organization_id = (select id from public.organizations where slug = 'norte-sul-acessorios')
  and tenant.environment = 'demo'
on conflict (tenant_id, module_key) do update
set enabled = excluded.enabled,
    updated_at = now();

-- Production starts only with domains already represented in the current MVP.
insert into public.tenant_modules (tenant_id, module_key, enabled)
select tenant.id, module.module_key, true
from public.tenants tenant
cross join unnest(array['catalog', 'inventory', 'ecommerce', 'integrations']) as module(module_key)
where tenant.organization_id = (select id from public.organizations where slug = 'norte-sul-acessorios')
  and tenant.environment = 'production'
on conflict (tenant_id, module_key) do update
set enabled = excluded.enabled,
    updated_at = now();
