-- Phase 1E.1 — secure first access, invitations and access context.
-- NOT auto-applied. Apply manually to the DEVELOPMENT Supabase project only.
-- Additive: no operational table is changed.

create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  organization_role text not null default 'admin'
    check (organization_role in ('owner', 'admin', 'billing', 'auditor')),
  tenant_role text not null default 'admin'
    check (tenant_role in ('owner', 'admin', 'manager', 'sales', 'cashier', 'stock', 'finance', 'accountant', 'support', 'viewer')),
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_invitations_organization_idx
  on public.tenant_invitations (organization_id, created_at desc);
create index if not exists tenant_invitations_email_idx
  on public.tenant_invitations (lower(email));

-- Data API grants are mandatory for new public tables (Supabase 2026 behaviour).
revoke all on public.tenant_invitations from anon, authenticated;
grant select, insert, update on public.tenant_invitations to authenticated;
grant all on public.tenant_invitations to service_role;

alter table public.tenant_invitations enable row level security;

drop trigger if exists tenant_invitations_set_updated_at on public.tenant_invitations;
create trigger tenant_invitations_set_updated_at before update on public.tenant_invitations
for each row execute function private.set_updated_at();

drop policy if exists tenant_invitations_admin_read on public.tenant_invitations;
create policy tenant_invitations_admin_read on public.tenant_invitations
for select to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']));

drop policy if exists tenant_invitations_admin_insert on public.tenant_invitations;
create policy tenant_invitations_admin_insert on public.tenant_invitations
for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin']));

drop policy if exists tenant_invitations_admin_update on public.tenant_invitations;
create policy tenant_invitations_admin_update on public.tenant_invitations
for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']))
with check (private.has_organization_role(organization_id, array['owner', 'admin']));

-- Tokens are never stored in clear text and never logged.
create or replace function private.hash_invitation_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

revoke all on function private.hash_invitation_token(text) from public;
grant execute on function private.hash_invitation_token(text) to authenticated, service_role;

-- Bootstrap path for the very first owner: callable only by trusted backend roles.
create or replace function private.create_owner_invitation(
  p_organization_slug text,
  p_email text,
  p_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select id into v_org from public.organizations where slug = p_organization_slug;
  if v_org is null then
    raise exception 'Organization % not found', p_organization_slug;
  end if;

  insert into public.tenant_invitations (
    organization_id, tenant_id, email, organization_role, tenant_role, token_hash, expires_at
  )
  values (
    v_org, null, lower(p_email), 'owner', 'owner',
    private.hash_invitation_token(p_token), now() + interval '7 days'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function private.create_owner_invitation(text, text, text) from public;
grant execute on function private.create_owner_invitation(text, text, text) to service_role;

-- Accepting an invitation is the ONLY self-service way to gain a membership.
-- Being the first authenticated user grants nothing.
create or replace function public.accept_tenant_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invitation public.tenant_invitations%rowtype;
  v_tenants integer := 0;
begin
  if v_user is null then
    raise exception 'Autenticacao obrigatoria';
  end if;

  select * into v_invitation
  from public.tenant_invitations
  where token_hash = private.hash_invitation_token(p_token)
  for update;

  if v_invitation.id is null then
    raise exception 'Convite invalido';
  end if;
  if v_invitation.revoked_at is not null then
    raise exception 'Convite revogado';
  end if;
  if v_invitation.accepted_at is not null then
    raise exception 'Convite ja utilizado';
  end if;
  if v_invitation.expires_at < now() then
    raise exception 'Convite expirado';
  end if;
  if lower(v_invitation.email) <> v_email then
    raise exception 'Convite emitido para outro e-mail';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role, active)
  values (v_invitation.organization_id, v_user, v_invitation.organization_role, true)
  on conflict (organization_id, user_id)
  do update set role = excluded.role, active = true, updated_at = now();

  insert into public.tenant_memberships (tenant_id, user_id, role, active)
  select tenant.id, v_user, v_invitation.tenant_role, true
  from public.tenants tenant
  where tenant.organization_id = v_invitation.organization_id
    and tenant.status = 'active'
    and (v_invitation.tenant_id is null or tenant.id = v_invitation.tenant_id)
  on conflict (tenant_id, user_id)
  do update set role = excluded.role, active = true, updated_at = now();

  get diagnostics v_tenants = row_count;

  update public.tenant_invitations
  set accepted_at = now(), accepted_by = v_user, updated_at = now()
  where id = v_invitation.id;

  insert into public.audit_events (
    organization_id, tenant_id, actor_user_id, action, resource_type, resource_id, metadata
  )
  values (
    v_invitation.organization_id, v_invitation.tenant_id, v_user,
    'invitation.accepted', 'tenant_invitations', v_invitation.id::text,
    jsonb_build_object('organization_role', v_invitation.organization_role,
                       'tenant_role', v_invitation.tenant_role)
  );

  return jsonb_build_object(
    'organization_id', v_invitation.organization_id,
    'organization_role', v_invitation.organization_role,
    'tenant_role', v_invitation.tenant_role,
    'tenants_linked', v_tenants
  );
end;
$$;

revoke all on function public.accept_tenant_invitation(text) from public;
grant execute on function public.accept_tenant_invitation(text) to authenticated;

-- Read-only access context used by guards, the pending screen and diagnostics.
create or replace function public.my_access_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'email', auth.jwt() ->> 'email',
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', org.id,
        'slug', org.slug,
        'legal_name', org.legal_name,
        'trade_name', org.trade_name,
        'status', org.status,
        'role', membership.role
      ) order by org.slug)
      from public.organization_memberships membership
      join public.organizations org on org.id = membership.organization_id
      where membership.user_id = auth.uid() and membership.active
    ), '[]'::jsonb),
    'tenants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tenant.id,
        'name', tenant.name,
        'slug', tenant.slug,
        'environment', tenant.environment,
        'status', tenant.status,
        'role', membership.role,
        'organization_id', tenant.organization_id,
        'storefront_slug', storefront.slug,
        'storefront_active', storefront.active
      ) order by tenant.environment)
      from public.tenant_memberships membership
      join public.tenants tenant on tenant.id = membership.tenant_id
      left join public.tenant_storefronts storefront on storefront.tenant_id = tenant.id
      where membership.user_id = auth.uid() and membership.active
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.my_access_context() from public;
grant execute on function public.my_access_context() to authenticated;
