begin;
drop policy if exists product_enrichment_jobs_write on public.product_enrichment_jobs;
create policy product_enrichment_jobs_insert on public.product_enrichment_jobs for insert to authenticated
with check ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy product_enrichment_jobs_update on public.product_enrichment_jobs for update to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])))
with check ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy product_enrichment_jobs_delete on public.product_enrichment_jobs for delete to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
drop policy if exists product_enrichment_candidates_write on public.product_enrichment_candidates;
create policy product_enrichment_candidates_insert on public.product_enrichment_candidates for insert to authenticated
with check ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy product_enrichment_candidates_update on public.product_enrichment_candidates for update to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])))
with check ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create policy product_enrichment_candidates_delete on public.product_enrichment_candidates for delete to authenticated
using ((select private.has_tenant_role(tenant_id,array['owner','admin','manager']::text[])));
create index if not exists product_enrichment_candidates_job_idx on public.product_enrichment_candidates(job_id,tenant_id);
create index if not exists product_enrichment_candidates_product_idx on public.product_enrichment_candidates(product_id,tenant_id);
commit;