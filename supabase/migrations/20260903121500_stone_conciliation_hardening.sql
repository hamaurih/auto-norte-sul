begin;

create policy stone_conciliation_inbox_deny_client_access
on public.stone_conciliation_inbox for all to authenticated
using (false)
with check (false);

create index stone_conciliation_inbox_integration_fk_idx
  on public.stone_conciliation_inbox (integration_id);
create index stone_pix_transactions_inbox_fk_idx
  on public.stone_pix_transactions (inbox_id);
create index stone_pix_transactions_integration_fk_idx
  on public.stone_pix_transactions (integration_id);

commit;
