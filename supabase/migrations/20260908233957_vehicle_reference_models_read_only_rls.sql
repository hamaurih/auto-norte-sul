-- Global, non-tenant vehicle dictionary: authenticated clients read; backend maintains it.
alter table public.vehicle_reference_models enable row level security;
revoke all on table public.vehicle_reference_models from public, anon, authenticated;
grant select on table public.vehicle_reference_models to authenticated;
grant all on table public.vehicle_reference_models to service_role;
create policy vehicle_reference_models_authenticated_read
on public.vehicle_reference_models for select to authenticated using (true);
