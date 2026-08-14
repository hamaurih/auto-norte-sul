-- Compatibilidade entre o saneamento já aplicado no DEV e a tela de revisão.
-- Não repete a normalização nem altera nomes, SKU, slug ou códigos de produtos.

begin;

alter table public.product_code_normalization_audit
  add column if not exists reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz;

update public.product_code_normalization_audit
set reason = coalesce(reason, review_reason)
where reason is null and review_reason is not null;

update public.product_code_normalization_audit
set created_at = coalesce(created_at, normalized_at, now())
where created_at is null;

alter table public.product_code_normalization_audit
  alter column created_at set default now();

create index if not exists product_code_norm_audit_tenant_status_idx
  on public.product_code_normalization_audit (tenant_id, status);

alter table public.product_code_normalization_audit enable row level security;

revoke all on table public.product_code_normalization_audit from anon;
revoke all on table public.product_code_normalization_audit from authenticated;
grant select, update on table public.product_code_normalization_audit to authenticated;
grant all on table public.product_code_normalization_audit to service_role;

drop policy if exists "code_audit_select_staff" on public.product_code_normalization_audit;
create policy "code_audit_select_staff"
  on public.product_code_normalization_audit
  for select
  to authenticated
  using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));

drop policy if exists "code_audit_write_staff" on public.product_code_normalization_audit;
create policy "code_audit_write_staff"
  on public.product_code_normalization_audit
  for update
  to authenticated
  using (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']))
  with check (private.has_tenant_role(tenant_id, array['owner','admin','manager','stock']));

commit;
