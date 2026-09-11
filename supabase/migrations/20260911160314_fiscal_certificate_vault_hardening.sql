begin;

create index if not exists fiscal_certificate_secrets_uploaded_by_idx
  on public.fiscal_certificate_secrets (uploaded_by);

drop policy if exists fiscal_certificate_secrets_deny_client_access
  on public.fiscal_certificate_secrets;
create policy fiscal_certificate_secrets_deny_client_access
  on public.fiscal_certificate_secrets
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

commit;
