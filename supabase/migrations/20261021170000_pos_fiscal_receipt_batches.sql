-- Agrupamento operacional de recibos de PDV. Nenhuma emissão fiscal ocorre aqui.
begin;
create table if not exists public.pos_fiscal_batches (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 customer_id uuid,
 fiscal_document_id uuid,
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
create unique index if not exists pos_fiscal_batches_document_unique on public.pos_fiscal_batches(tenant_id,fiscal_document_id) where fiscal_document_id is not null;
create index if not exists pos_fiscal_batches_tenant_idx on public.pos_fiscal_batches(tenant_id,created_at desc);
create index if not exists pos_fiscal_batch_sales_batch_idx on public.pos_fiscal_batch_sales(batch_id);
alter table public.pos_fiscal_batches enable row level security;
alter table public.pos_fiscal_batch_sales enable row level security;
drop policy if exists pos_fiscal_batches_read on public.pos_fiscal_batches;
drop policy if exists pos_fiscal_batch_sales_read on public.pos_fiscal_batch_sales;
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
 select count(distinct s.tenant_id), (array_agg(s.tenant_id))[1],count(distinct coalesce(s.customer_id::text,'__anon__'))
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
 if exists(select 1 from public.pos_sales s where s.tenant_id=v_tenant and s.id=any(p_sale_ids) and s.status::text<>'paid')
 then raise exception 'Somente vendas concluídas podem ser selecionadas';end if;
 if v_count<>1 then raise exception 'Agrupe apenas vendas do mesmo cliente';end if;
 if exists(select 1 from public.pos_fiscal_batch_sales x where x.tenant_id=v_tenant and x.sale_id=any(p_sale_ids))
 then raise exception 'Uma venda selecionada já está vinculada a um lote fiscal';end if;
 if exists (select 1 from public.pos_sales s where s.tenant_id=v_tenant and s.id=any(p_sale_ids) and (nullif(s.fiscal_document_id,'') is not null or s.fiscal_status <> 'pending')) then raise exception 'Há vendas com documento fiscal previamente vinculado; revise individualmente';end if;
 select customer_id into v_customer from public.pos_sales where tenant_id=v_tenant and id=p_sale_ids[1];
 insert into public.pos_fiscal_batches(tenant_id,customer_id,created_by,notes)
 values(v_tenant,v_customer,v_user,left(nullif(trim(p_notes),''),1000)) returning id into v_batch;
 insert into public.pos_fiscal_batch_sales(tenant_id,batch_id,sale_id)
 select v_tenant,v_batch,unnest(p_sale_ids);
 return v_batch;
end$$;
revoke all on function public.create_pos_fiscal_batch(uuid[],text) from public,anon;
grant execute on function public.create_pos_fiscal_batch(uuid[],text) to authenticated;
-- Cancel a pending batch and release receipt links without changing the original sales.
create or replace function public.cancel_pos_fiscal_batch(p_batch_id uuid)
returns boolean language plpgsql security definer set search_path='' as $
declare v_user uuid:=auth.uid();v_batch public.pos_fiscal_batches;
begin
 select * into v_batch from public.pos_fiscal_batches where id=p_batch_id for update;
 if v_batch.id is null then raise exception 'Solicitação fiscal não encontrada';end if;
 if not exists(select 1 from public.tenant_memberships where tenant_id=v_batch.tenant_id and user_id=v_user and active and role in ('owner','admin','manager','sales')) then raise exception 'Acesso negado'; end if;
 if v_batch.status<>'pending_review' or v_batch.fiscal_document_id is not null then raise exception 'Lote já processado não pode ser desvinculado';end if;
 delete from public.pos_fiscal_batch_sales where batch_id=v_batch.id and tenant_id=v_batch.tenant_id;
 update public.pos_fiscal_batches set status='cancelled',reviewed_by=v_user,reviewed_at=now() where id=v_batch.id;
 return true;
end$;
revoke all on function public.cancel_pos_fiscal_batch(uuid) from public,anon;
grant execute on function public.cancel_pos_fiscal_batch(uuid) to authenticated;

-- Only creates a draft. This is NOT SEFAZ authorization, invoice transmission or fiscal permission to defer invoices.
create or replace function public.prepare_pos_fiscal_batch_draft(p_batch_id uuid,p_model text default '55')
returns uuid language plpgsql security definer set search_path='' as $
declare
 v_user uuid:=auth.uid();v_batch public.pos_fiscal_batches;v_settings public.fiscal_settings;
 v_count int;v_missing int;v_total numeric(18,2);v_subtotal numeric(18,2);
 v_discount numeric(18,2);v_number integer;v_series integer;v_doc uuid;v_name text;v_tax_id text;v_branch uuid;
begin
 select * into v_batch from public.pos_fiscal_batches where id=p_batch_id for update;
 if v_batch.id is null then raise exception 'Lote não encontrado';end if;
 if not exists(select 1 from public.tenant_memberships m where m.tenant_id=v_batch.tenant_id and m.user_id=v_user and m.active and m.role in ('owner','admin','manager','sales')) then raise exception 'Sem permissão fiscal';end if;
 if v_batch.fiscal_document_id is not null then return v_batch.fiscal_document_id;end if;
 if v_batch.status<>'pending_review' then raise exception 'Lote não está pendente';end if;
 if p_model not in ('55','65') then raise exception 'Modelo fiscal inválido';end if;
 select count(*),coalesce(sum(s.total),0),coalesce(sum(s.subtotal),0),coalesce(sum(s.discount_amount),0),count(distinct cs.branch_id)
 into v_count,v_total,v_subtotal,v_discount,v_missing
 from public.pos_fiscal_batch_sales x
 join public.pos_sales s on s.id=x.sale_id and s.tenant_id=x.tenant_id
 join public.pos_cash_sessions cs on cs.id=s.cash_session_id
 where x.batch_id=p_batch_id and x.tenant_id=v_batch.tenant_id and s.status::text='paid' and nullif(s.fiscal_document_id,'') is null;
 if v_count=0 then raise exception 'Lote vazio ou contém vendas não elegíveis';end if;
 if v_count<>(select count(*) from public.pos_fiscal_batch_sales where batch_id=p_batch_id) then raise exception 'Alguma venda foi cancelada ou já possui documento fiscal';end if;
 if v_missing<>1 then raise exception 'Não é permitido misturar filiais';end if;
 if v_discount <> 0 then raise exception 'Vendas com desconto total exigem rateio fiscal validado antes da preparação; não é seguro emitir rascunho ainda';end if;
 select cs.branch_id into v_branch
 from public.pos_fiscal_batch_sales x join public.pos_sales s on s.id=x.sale_id
 join public.pos_cash_sessions cs on cs.id=s.cash_session_id where x.batch_id=p_batch_id limit 1;
 select * into v_settings from public.fiscal_settings
 where tenant_id=v_batch.tenant_id and branch_id=v_branch and enabled and environment='homologation' for update;
 if v_settings.id is null then raise exception 'Configuração fiscal de homologação não encontrada na filial';end if;
 if p_model='65' and (v_settings.csc_id is null or v_settings.csc_secret_ref is null) then raise exception 'CSC NFC-e não configurado';end if;
 if exists (
 select 1 from public.pos_fiscal_batch_sales x
 join public.pos_sale_items i on i.sale_id=x.sale_id and i.tenant_id=x.tenant_id
 left join public.product_fiscal_profiles pf on pf.product_id=i.product_id and pf.tenant_id=i.tenant_id
 where x.batch_id=p_batch_id and (pf.id is null or nullif(pf.ncm,'') is null)
 ) then raise exception 'Há itens sem perfil fiscal completo';end if;
 if v_batch.customer_id is not null then
 select c.name,c.document into v_name,v_tax_id from public.customers c
 where c.id=v_batch.customer_id and c.tenant_id=v_batch.tenant_id;
 end if;
 v_name:=coalesce(nullif(v_name,''),'Consumidor não identificado');
 if p_model='55' and (v_batch.customer_id is null or nullif(v_tax_id,'') is null) then raise exception 'Identifique o cliente e documento para preparar NF-e';end if;
 if p_model='55' then
 v_number:=v_settings.next_nfe_number;v_series:=v_settings.nfe_series;
 update public.fiscal_settings set next_nfe_number=next_nfe_number+1,updated_by=v_user where id=v_settings.id;
 else
 v_number:=v_settings.next_nfce_number;v_series:=v_settings.nfce_series;
 update public.fiscal_settings set next_nfce_number=next_nfce_number+1,updated_by=v_user where id=v_settings.id;
 end if;
 insert into public.fiscal_documents(tenant_id,branch_id,model,environment,series,number,status,recipient_name,recipient_tax_id,totals,tax_totals,provider,created_by)
 values(v_batch.tenant_id,v_branch,p_model,'homologation',v_series,v_number,'draft',v_name,v_tax_id,
 jsonb_build_object('subtotal',v_subtotal,'discount',v_discount,'shipping',0,'total',v_total),'{}'::jsonb,v_settings.provider,v_user)
 returning id into v_doc;
 insert into public.fiscal_document_items(tenant_id,fiscal_document_id,product_id,line_number,sku,description,gtin,ncm,cest,cfop,quantity,unit_value,gross_value,discount_value,net_value,tax_snapshot)
 select v_batch.tenant_id,v_doc,i.product_id,row_number()over(order by s.created_at,i.id),
 coalesce(p.sku,''),p.name,p.gtin,pf.ncm,pf.cest,pf.cfop_in_state,i.quantity,i.unit_price,
 round(i.quantity*i.unit_price,2),greatest(round(i.quantity*i.unit_price-i.line_total,2),0),i.line_total,
 jsonb_build_object('origin',pf.origin,'icms_cst',pf.icms_cst,'icms_csosn',pf.icms_csosn,'icms_rate',pf.icms_rate,
 'pis_cst',pf.pis_cst,'pis_rate',pf.pis_rate,'cofins_cst',pf.cofins_cst,'cofins_rate',pf.cofins_rate,
 'ibs_cst',pf.ibs_cst,'ibs_classification',pf.ibs_classification,'ibs_rate',pf.ibs_rate,
 'cbs_cst',pf.cbs_cst,'cbs_classification',pf.cbs_classification,'cbs_rate',pf.cbs_rate)
 from public.pos_fiscal_batch_sales x
 join public.pos_sales s on s.id=x.sale_id and s.tenant_id=x.tenant_id
 join public.pos_sale_items i on i.sale_id=s.id and i.tenant_id=s.tenant_id
 join public.products p on p.id=i.product_id and p.tenant_id=i.tenant_id
 join public.product_fiscal_profiles pf on pf.product_id=i.product_id and pf.tenant_id=i.tenant_id
 where x.batch_id=p_batch_id order by s.created_at,i.id;
 insert into public.fiscal_document_events(tenant_id,fiscal_document_id,event_type,message,payload,created_by)
 values(v_batch.tenant_id,v_doc,'created','Rascunho vinculado a recibos do PDV',jsonb_build_object('batch_id',p_batch_id,'receipts',v_count),v_user);
 update public.pos_fiscal_batches set fiscal_document_id=v_doc,status='reviewed',reviewed_by=v_user,reviewed_at=now() where id=p_batch_id;
 update public.pos_sales s set fiscal_document_id=v_doc::text,fiscal_status='pending'
 where s.tenant_id=v_batch.tenant_id and s.id in (select sale_id from public.pos_fiscal_batch_sales where batch_id=p_batch_id);
 return v_doc;
end$;
revoke all on function public.prepare_pos_fiscal_batch_draft(uuid,text) from public,anon;
grant execute on function public.prepare_pos_fiscal_batch_draft(uuid,text) to authenticated;
-- Update linked POS sales when the fiscal engine changes authorization status.
-- No stock, cash, payment or commission adjustments are performed by this trigger.
create or replace function public.sync_pos_batch_fiscal_document_status()
returns trigger language plpgsql security definer set search_path='' as $
begin
 if new.status is distinct from old.status and new.status in ('authorized','rejected','cancelled') then
  update public.pos_sales s
  set fiscal_status=case new.status when 'authorized' then 'authorized' when 'rejected' then 'rejected' else 'cancelled' end
  where s.tenant_id=new.tenant_id and s.fiscal_document_id=new.id::text
  and exists(select 1 from public.pos_fiscal_batches b where b.tenant_id=new.tenant_id and b.fiscal_document_id=new.id);
 end if;
 return new;
end$;
drop trigger if exists trg_sync_pos_batch_document_status on public.fiscal_documents;
create trigger trg_sync_pos_batch_document_status after update of status on public.fiscal_documents
for each row execute function public.sync_pos_batch_fiscal_document_status();
revoke all on function public.sync_pos_batch_fiscal_document_status() from public,anon,authenticated;
commit;
