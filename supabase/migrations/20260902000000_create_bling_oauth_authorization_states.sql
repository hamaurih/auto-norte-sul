create table if not exists public.oauth_authorization_states (
  state_hash text primary key,
  provider text not null check (provider in ('bling')),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  config_id uuid not null references public.bling_config(id) on delete cascade,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.oauth_authorization_states
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

update public.oauth_authorization_states s
set tenant_id = c.tenant_id
from public.bling_config c
where s.config_id = c.id
  and s.tenant_id is null
  and c.tenant_id is not null;

do $$
declare
  v_tenant uuid;
begin
  if exists (select 1 from public.oauth_authorization_states where tenant_id is null) then
    select id into v_tenant
    from public.tenants
    where environment = 'production'
    order by created_at
    limit 1;

    if v_tenant is null then
      raise exception 'Nao foi possivel definir tenant production para oauth_authorization_states';
    end if;

    update public.oauth_authorization_states
    set tenant_id = v_tenant
    where tenant_id is null;
  end if;
end $$;

alter table public.oauth_authorization_states alter column tenant_id set not null;

create index if not exists oauth_authorization_states_expires_idx
  on public.oauth_authorization_states(expires_at);

create index if not exists idx_oauth_states_tenant
  on public.oauth_authorization_states(tenant_id);

create index if not exists idx_oauth_states_config
  on public.oauth_authorization_states(config_id);

alter table public.oauth_authorization_states enable row level security;
revoke all on table public.oauth_authorization_states from public, anon, authenticated;
grant select, insert, update, delete on table public.oauth_authorization_states to service_role;

drop policy if exists oauth_authorization_states_deny_clients on public.oauth_authorization_states;
create policy oauth_authorization_states_deny_clients
on public.oauth_authorization_states
for all
to anon, authenticated
using (false)
with check (false);

notify pgrst, 'reload schema';
