begin;
create index if not exists shipment_packages_fk_idx on public.shipment_packages(shipment_id, tenant_id);
create index if not exists shipment_events_fk_idx on public.shipment_events(shipment_id, tenant_id);
commit;