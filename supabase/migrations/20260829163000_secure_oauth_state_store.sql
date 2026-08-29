create table if not exists public.oauth_authorization_states (
  state_hash text primary key,
  provider text not null check (provider in ('bling')),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  config_id uuid not null references public.bling_config(id) on delete cascade,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_authorization_states_expires_idx
  on public.oauth_authorization_states(expires_at);

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
