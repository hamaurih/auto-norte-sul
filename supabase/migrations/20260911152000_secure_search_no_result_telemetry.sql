-- Remove direct public writes to search telemetry.
-- Anonymous/site and MCP clients must go through a narrow, tenant-derived,
-- rate-limited RPC. The privileged implementation lives in private.

drop policy if exists "Search no-result public tenant insert" on public.search_no_result_logs;
drop policy if exists "snrl_public_insert_validated" on public.search_no_result_logs;
drop policy if exists "snrl_public_insert" on public.search_no_result_logs;

revoke all on table public.search_no_result_logs from anon;
revoke insert, update, truncate, trigger, references on table public.search_no_result_logs from authenticated;
grant select, delete on table public.search_no_result_logs to authenticated;

grant usage on schema private to anon, authenticated, service_role;

create or replace function private.log_search_no_result_impl(
  p_term text,
  p_normalized_term text,
  p_origin text,
  p_matched_alias text default null,
  p_matched_brand text default null,
  p_matched_category text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_term text := btrim(coalesce(p_term, ''));
  v_normalized text := btrim(coalesce(p_normalized_term, ''));
  v_origin text := lower(btrim(coalesce(p_origin, '')));
begin
  v_tenant_id := private.requested_storefront_tenant_id();

  if v_tenant_id is null then
    return false;
  end if;

  if char_length(v_term) < 1 or char_length(v_term) > 200 then
    return false;
  end if;

  if char_length(v_normalized) < 1 or char_length(v_normalized) > 200 then
    return false;
  end if;

  if v_origin not in ('site', 'mcp', 'ia', 'admin') then
    return false;
  end if;

  -- Suppress repeated identical misses for the same tenant/origin.
  if exists (
    select 1
    from public.search_no_result_logs l
    where l.tenant_id = v_tenant_id
      and l.normalized_term = v_normalized
      and l.origin = v_origin
      and l.created_at >= now() - interval '5 minutes'
  ) then
    return false;
  end if;

  -- Hard cap protects the public telemetry table from write amplification.
  if (
    select count(*)
    from public.search_no_result_logs l
    where l.tenant_id = v_tenant_id
      and l.created_at >= now() - interval '1 minute'
  ) >= 30 then
    return false;
  end if;

  insert into public.search_no_result_logs (
    tenant_id,
    term,
    normalized_term,
    origin,
    results_count,
    matched_alias,
    matched_brand,
    matched_category
  )
  values (
    v_tenant_id,
    v_term,
    v_normalized,
    v_origin,
    0,
    nullif(left(btrim(coalesce(p_matched_alias, '')), 200), ''),
    nullif(left(btrim(coalesce(p_matched_brand, '')), 200), ''),
    nullif(left(btrim(coalesce(p_matched_category, '')), 200), '')
  );

  return true;
end
$$;

revoke all on function private.log_search_no_result_impl(text,text,text,text,text,text)
  from public;
grant execute on function private.log_search_no_result_impl(text,text,text,text,text,text)
  to anon, authenticated, service_role;

create or replace function public.log_search_no_result(
  p_term text,
  p_normalized_term text,
  p_origin text,
  p_matched_alias text default null,
  p_matched_brand text default null,
  p_matched_category text default null
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.log_search_no_result_impl(
    $1, $2, $3, $4, $5, $6
  );
$$;

revoke all on function public.log_search_no_result(text,text,text,text,text,text)
  from public;
grant execute on function public.log_search_no_result(text,text,text,text,text,text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
