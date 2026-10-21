-- Agrupamento operacional de recibos de PDV. Nenhuma emissão fiscal ocorre aqui.
begin;
create table if not exists public.pos_fiscal_batches (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid,
 status text not null default 'pending_review' check (status in ('pending_review','reviewed','cancelled')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 notes text,
 unique(id,tenant_id)
);
create table if not exists public.pos_fiscal_batch_sales (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 batch_id uuid not null,
 sale_id uuid not null,
 created_at timestamptz not null default now(),
 constraint pos_batch_sales_batch_fk foreign key(batch_id,tenant_id) references public.pos_fiscal_batches(id,tenant_id) on delete cascade,
 unique(tenant_id,sale_id),
 unique(batch_id,sale_id)
);
create index if not exists pos_fiscal_batches_tenant_idx on public.pos_fiscal_batches(tenant_id,created_at desc);
create index if not exists pos_fiscal_batch_sales_batch_idx on public.pos_fiscal_batch_sales(batch_id);
alter table public.pos_fiscal_batches enable row level security;
alter table public.pos_fiscal_batch_sales enable row level security;
create policy pos_fiscal_batches_read on public.pos_fiscal_batches for select to authenticated
 using (private.has_tenant_role(tenant_id,null));
create policy pos_fiscal_batch_sales_read on public.pos_fiscal_batch_sales for select to authenticated
 using (private.has_tenant_role(tenant_id,null));
grant select on public.pos_fiscal_batches, public.pos_fiscal_batch_sales to authenticated;
grant all on public.pos_fiscal_batches, public.pos_fiscal_batch_sales to service_role;
revoke all on public.pos_fiscal_batches, public.pos_fiscal_batch_sales from anon;
create or replace function public.create_pos_fiscal_batch(p_sale_ids uuid[],p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_tenant uuid;v_customer uuid;v_count int;v_distinct int;v_batch uuid;
begin
 if v_user is null then raise exception 'Usuário não autenticado'; end if;
 if p_sale_ids is null or cardinality(p_sale_ids)<1 or cardinality(p_sale_ids)>100
   then raise exception 'Selecione de 1 a 100 vendas'; end if;
 select count(distinct s.tenant_id), min(s.tenant_id),count(distinct coalesce(s.customer_id::text,'__anon__'))
 into v_distinct,v_tenant,v_count
 from public.pos_sales s where s.id=any(p_sale_ids);
 if v_distinct<>1 or v_tenant is null then raise exception 'Vendas não encontradas no mesmo estabelecimento';end if;
 if not exists(select 1 from public.tenant_memberships m where m.user_id=v_user and m.tenant_id=v_tenant and m.active and m.role in ('owner','admin','manager','sales'))
 then raise exception 'Usuário sem autorização para solicitar faturamento';end if;
 if cardinality(p_sale_ids)<>(select count(distinct unnest_id) from unnest(p_sale_ids) as unnest_id)
 then raise exception 'Seleção contém vendas repetidas';end if;
 perform 1 from public.pos_sales s where s.tenant_id=v_tenant and s.id=any(p_sale_ids) order by s.id for update;
 if (select count(*) from public.pos_sales s where s.tenant_id=v_tenant and s.id=any(p_sale_ids))<>cardinality(p_sale_ids)
 then raise exception 'Uma ou mais vendas não existem';end if;
 if exists(select 1 from public.pos_sales s where s.tenant_id=v_tenant and s.id=any(p_sale_ids) and s.status::text<>'completed')
 then raise exception 'Somente vendas concluídas podem ser selecionadas';end if;
 if v_count<>1 then raise exception 'Agrupe apenas vendas do mesmo cliente';end if;
 if exists(select 1 from public.pos_fiscal_batch_sales x where x.tenant_id=v_tenant and x.sale_id=any(p_sale_ids))
 then raise exception 'Uma venda selecionada já está vinculada a um lote fiscal';end if;
 select customer_id into v_customer from public.pos_sales where tenant_id=v_tenant and id=p_sale_ids[1];
 insert into public.pos_fiscal_batches(tenant_id,customer_id,created_by,notes)
 values(v_tenant,v_customer,v_user,left(nullif(trim(p_notes),''),1000)) returning id into v_batch;
 insert into public.pos_fiscal_batch_sales(tenant_id,batch_id,sale_id)
 select v_tenant,v_batch,unnest(p_sale_ids);
 return v_batch;
end$$;
revoke all on function public.create_pos_fiscal_batch(uuid[],text) from public,anon;
grant execute on function public.create_pos_fiscal_batch(uuid[],text) to authenticated;
commit;
