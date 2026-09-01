-- Exact, tenant-scoped catalog sanitation metrics and durable Bling image sync state.

alter table public.bling_config
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists last_image_sync_product_id uuid references public.products(id) on delete set null,
  add column if not exists last_image_sync_at timestamptz;

update public.bling_config
set tenant_id = (
  select p.tenant_id
  from public.products p
  group by p.tenant_id
  order by count(*) desc
  limit 1
)
where tenant_id is null;

alter table public.bling_config alter column tenant_id set not null;
create unique index if not exists bling_config_tenant_id_uidx
  on public.bling_config (tenant_id);

create or replace function public.catalog_image_url_is_usable(p_url text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when nullif(btrim(p_url), '') is null then false
    when p_url ~ '[?&]Expires=[0-9]+' then
      ((regexp_match(p_url, '[?&]Expires=([0-9]+)'))[1])::numeric >= extract(epoch from now())
    when lower(p_url) like 'https://orgbling.s3.amazonaws.com/%' then false
    else true
  end;
$$;

revoke all on function public.catalog_image_url_is_usable(text) from public;
grant execute on function public.catalog_image_url_is_usable(text) to authenticated;

create or replace function public.get_catalog_sanitation_stats(p_tenant_id uuid)
returns table (
  total bigint,
  sem_marca bigint,
  sem_categoria bigint,
  sem_sku bigint,
  sem_preco bigint,
  sem_estoque bigint,
  sem_imagem bigint,
  imagem_expirada bigint,
  imagens_validas bigint,
  sem_aplicacao bigint,
  sem_multi_estoque bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with active_products as (
    select p.*
    from public.products p
    where p.tenant_id = p_tenant_id
      and p.active is true
      and p.deleted_at is null
  )
  select
    count(*)::bigint,
    count(*) filter (where p.brand_id is null)::bigint,
    count(*) filter (where p.category_id is null)::bigint,
    count(*) filter (where nullif(btrim(p.sku), '') is null)::bigint,
    count(*) filter (where coalesce(p.price_b2c, 0) <= 0)::bigint,
    count(*) filter (where coalesce(p.stock, 0) <= 0)::bigint,
    count(*) filter (where not exists (
      select 1 from public.product_images pi
      where pi.tenant_id = p_tenant_id
        and pi.product_id = p.id
        and public.catalog_image_url_is_usable(pi.url)
    ))::bigint,
    count(*) filter (where exists (
      select 1 from public.product_images pi
      where pi.tenant_id = p_tenant_id and pi.product_id = p.id
    ) and not exists (
      select 1 from public.product_images pi
      where pi.tenant_id = p_tenant_id
        and pi.product_id = p.id
        and public.catalog_image_url_is_usable(pi.url)
    ))::bigint,
    count(*) filter (where exists (
      select 1 from public.product_images pi
      where pi.tenant_id = p_tenant_id
        and pi.product_id = p.id
        and public.catalog_image_url_is_usable(pi.url)
    ))::bigint,
    count(*) filter (where not exists (
      select 1 from public.product_applications pa
      where pa.tenant_id = p_tenant_id and pa.product_id = p.id
    ))::bigint,
    count(*) filter (where not exists (
      select 1 from public.product_stock ps
      where ps.tenant_id = p_tenant_id and ps.product_id = p.id
    ))::bigint
  from active_products p;
$$;

revoke all on function public.get_catalog_sanitation_stats(uuid) from public;
grant execute on function public.get_catalog_sanitation_stats(uuid) to authenticated;

create or replace function public.list_catalog_sanitation_products(
  p_tenant_id uuid,
  p_problem text,
  p_limit integer default 100,
  p_offset integer default 0,
  p_search text default null
)
returns table (
  id uuid,
  sku text,
  name text,
  internal_code text,
  brand_id uuid,
  category_id uuid,
  price_b2c numeric,
  stock integer,
  active boolean,
  bling_id text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id, p.sku, p.name, p.internal_code, p.brand_id, p.category_id,
    p.price_b2c, p.stock, p.active, p.bling_id, count(*) over()::bigint
  from public.products p
  where p.tenant_id = p_tenant_id
    and p.active is true
    and p.deleted_at is null
    and (
      p_search is null
      or p.name ilike '%' || p_search || '%'
      or p.sku ilike '%' || p_search || '%'
    )
    and case p_problem
      when 'sem_marca' then p.brand_id is null
      when 'sem_categoria' then p.category_id is null
      when 'sem_sku' then nullif(btrim(p.sku), '') is null
      when 'sem_preco' then coalesce(p.price_b2c, 0) <= 0
      when 'sem_estoque' then coalesce(p.stock, 0) <= 0
      when 'sem_imagem' then not exists (
        select 1 from public.product_images pi
        where pi.tenant_id = p_tenant_id
          and pi.product_id = p.id
          and public.catalog_image_url_is_usable(pi.url)
      )
      when 'sem_aplicacao' then not exists (
        select 1 from public.product_applications pa
        where pa.tenant_id = p_tenant_id and pa.product_id = p.id
      )
      when 'sem_multi' then not exists (
        select 1 from public.product_stock ps
        where ps.tenant_id = p_tenant_id and ps.product_id = p.id
      )
      else false
    end
  order by p.name, p.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_catalog_sanitation_products(uuid, text, integer, integer, text) from public;
grant execute on function public.list_catalog_sanitation_products(uuid, text, integer, integer, text) to authenticated;
