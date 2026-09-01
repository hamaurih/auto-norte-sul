-- Complemento idempotente para instalações que já aplicaram catalog_taxonomy_v2.
-- Mantém todos os FKs novos indexados e evita políticas SELECT permissivas duplicadas.

create index if not exists catalog_taxonomy_rules_category_idx
  on public.catalog_taxonomy_rules (tenant_id, category_slug);
create index if not exists catalog_taxonomy_rules_subcategory_idx
  on public.catalog_taxonomy_rules (tenant_id, subcategory_slug);

create index if not exists product_taxonomy_audit_previous_category_idx
  on public.product_taxonomy_assignment_audit (previous_category_id, tenant_id)
  where previous_category_id is not null;
create index if not exists product_taxonomy_audit_product_fk_idx
  on public.product_taxonomy_assignment_audit (product_id, tenant_id);
create index if not exists product_taxonomy_audit_applied_by_idx
  on public.product_taxonomy_assignment_audit (applied_by) where applied_by is not null;
create index if not exists product_taxonomy_audit_previous_subcategory_idx
  on public.product_taxonomy_assignment_audit (previous_subcategory_id, tenant_id)
  where previous_subcategory_id is not null;
create index if not exists product_taxonomy_audit_assigned_category_idx
  on public.product_taxonomy_assignment_audit (assigned_category_id, tenant_id);
create index if not exists product_taxonomy_audit_assigned_subcategory_idx
  on public.product_taxonomy_assignment_audit (assigned_subcategory_id, tenant_id);

drop policy if exists catalog_taxonomy_rules_write_manager on public.catalog_taxonomy_rules;

drop policy if exists catalog_taxonomy_rules_insert_manager on public.catalog_taxonomy_rules;
create policy catalog_taxonomy_rules_insert_manager
on public.catalog_taxonomy_rules for insert to authenticated
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])));

drop policy if exists catalog_taxonomy_rules_update_manager on public.catalog_taxonomy_rules;
create policy catalog_taxonomy_rules_update_manager
on public.catalog_taxonomy_rules for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])));

drop policy if exists catalog_taxonomy_rules_delete_manager on public.catalog_taxonomy_rules;
create policy catalog_taxonomy_rules_delete_manager
on public.catalog_taxonomy_rules for delete to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])));
