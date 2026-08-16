begin;

drop policy if exists shipment_packages_staff_write on public.shipment_packages;

drop policy if exists shipment_packages_staff_insert on public.shipment_packages;
create policy shipment_packages_staff_insert on public.shipment_packages for insert to authenticated
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]));

drop policy if exists shipment_packages_staff_update on public.shipment_packages;
create policy shipment_packages_staff_update on public.shipment_packages for update to authenticated
using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]))
with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::text[]));

create index if not exists shipments_picker_idx on public.shipments(picker_user_id) where picker_user_id is not null;
create index if not exists shipments_checker_idx on public.shipments(checker_user_id) where checker_user_id is not null;
create index if not exists shipments_created_by_idx on public.shipments(created_by) where created_by is not null;
create index if not exists shipment_events_actor_idx on public.shipment_events(actor_user_id) where actor_user_id is not null;

commit;