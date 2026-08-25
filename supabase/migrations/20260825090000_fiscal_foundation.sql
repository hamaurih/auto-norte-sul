begin;

create table if not exists public.fiscal_settings (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 branch_id uuid not null,
 environment text not null default 'homologation' check(environment in('homologation','production')),
 provider text not null default 'internal' check(provider in('internal','focus_nfe','nuvem_fiscal','plugnotas','other')),
 legal_name text not null,
 trade_name text,
 tax_id text not null,
 state_tax_id text not null,
 municipal_tax_id text,
 tax_regime text not null check(tax_regime in('simples_nacional','simples_excesso','regime_normal','mei')),
 crt smallint not null check(crt in(1,2,3,4)),
 state text not null,
 city_code text not null,
 city text not null,
 zip_code text not null,
 street text not null,
 number text not null,
 complement text,
 district text not null,
 phone text,
 email text,
 nfe_series integer not null default 1 check(nfe_series between 1 and 999),
 nfce_series integer not null default 1 check(nfce_series between 1 and 999),
 next_nfe_number integer not null default 1 check(next_nfe_number>0),
 next_nfce_number integer not null default 1 check(next_nfce_number>0),
 certificate_secret_ref text,
 certificate_expires_at timestamptz,
 csc_id text,
 csc_secret_ref text,
 ibs_enabled boolean not null default true,
 cbs_enabled boolean not null default true,
 enabled boolean not null default false,
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(tenant_id,branch_id),
 constraint fiscal_settings_branch_tenant_fkey foreign key(branch_id,tenant_id) references public.branches(id,tenant_id) on delete cascade,
 constraint fiscal_settings_tax_id_check check(tax_id ~ '^[0-9]{14}$'),
 constraint fiscal_settings_state_check check(state ~ '^[A-Z]{2}$')
);

create table if not exists public.product_fiscal_profiles (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 product_id uuid not null,
 ncm text not null,
 cest text,
 origin smallint not null default 0 check(origin between 0 and 8),
 cfop_in_state text,
 cfop_out_state text,
 icms_cst text,
 icms_csosn text,
 icms_rate numeric(9,6) not null default 0 check(icms_rate>=0),
 pis_cst text,
 pis_rate numeric(9,6) not null default 0 check(pis_rate>=0),
 cofins_cst text,
 cofins_rate numeric(9,6) not null default 0 check(cofins_rate>=0),
 ibs_cst text,
 ibs_classification text,
 ibs_rate numeric(9,6) not null default 0 check(ibs_rate>=0),
 cbs_cst text,
 cbs_classification text,
 cbs_rate numeric(9,6) not null default 0 check(cbs_rate>=0),
 tax_benefit_code text,
 notes text,
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(tenant_id,product_id),
 constraint product_fiscal_profiles_product_tenant_fkey foreign key(product_id,tenant_id) references public.products(id,tenant_id) on delete cascade,
 constraint product_fiscal_profiles_ncm_check check(ncm ~ '^[0-9]{8}$')
);

create table if not exists public.fiscal_documents (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 branch_id uuid not null,
 order_id uuid,
 model text not null check(model in('55','65')),
 environment text not null check(environment in('homologation','production')),
 series integer not null check(series between 1 and 999),
 number integer not null check(number>0),
 status text not null default 'draft' check(status in('draft','validation_failed','queued','processing','authorized','rejected','cancelled','denied','contingency')),
 access_key text,
 protocol text,
 authorization_code text,
 issued_at timestamptz,
 authorized_at timestamptz,
 cancelled_at timestamptz,
 cancellation_reason text,
 recipient_name text not null,
 recipient_tax_id text,
 recipient_email text,
 recipient_phone text,
 recipient_address jsonb not null default '{}'::jsonb,
 totals jsonb not null default '{}'::jsonb,
 tax_totals jsonb not null default '{}'::jsonb,
 xml_path text,
 danfe_path text,
 provider text not null,
 provider_reference text,
 last_error_code text,
 last_error_message text,
 idempotency_key uuid not null default gen_random_uuid(),
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint fiscal_documents_branch_tenant_fkey foreign key(branch_id,tenant_id) references public.branches(id,tenant_id) on delete restrict,
 constraint fiscal_documents_order_tenant_fkey foreign key(order_id,tenant_id) references public.orders(id,tenant_id) on delete restrict,
 unique(tenant_id,model,series,number),
 unique(tenant_id,idempotency_key)
);
create unique index if not exists fiscal_documents_order_model_active_unique on public.fiscal_documents(tenant_id,order_id,model) where order_id is not null and status<>'cancelled';

create table if not exists public.fiscal_document_items (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 fiscal_document_id uuid not null,
 order_item_id uuid,
 product_id uuid,
 line_number integer not null check(line_number>0),
 sku text not null,
 description text not null,
 gtin text,
 ncm text,
 cest text,
 cfop text,
 unit text not null default 'UN',
 quantity numeric(18,4) not null check(quantity>0),
 unit_value numeric(18,4) not null check(unit_value>=0),
 gross_value numeric(18,2) not null check(gross_value>=0),
 discount_value numeric(18,2) not null default 0 check(discount_value>=0),
 net_value numeric(18,2) not null check(net_value>=0),
 tax_snapshot jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 constraint fiscal_document_items_document_tenant_fkey foreign key(fiscal_document_id,tenant_id) references public.fiscal_documents(id,tenant_id) on delete cascade,
 constraint fiscal_document_items_product_tenant_fkey foreign key(product_id,tenant_id) references public.products(id,tenant_id) on delete set null,
 unique(fiscal_document_id,line_number)
);

create table if not exists public.fiscal_document_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 fiscal_document_id uuid not null,
 event_type text not null check(event_type in('created','validated','queued','submitted','authorized','rejected','cancel_requested','cancelled','contingency','error')),
 sequence integer not null default 1 check(sequence>0),
 protocol text,
 status_code text,
 message text,
 payload jsonb not null default '{}'::jsonb,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 constraint fiscal_document_events_document_tenant_fkey foreign key(fiscal_document_id,tenant_id) references public.fiscal_documents(id,tenant_id) on delete cascade
);

alter table public.fiscal_documents add constraint fiscal_documents_id_tenant_key unique(id,tenant_id);
alter table public.branches add constraint branches_id_tenant_key unique(id,tenant_id);
alter table public.orders add constraint orders_id_tenant_key unique(id,tenant_id);

create index if not exists fiscal_settings_tenant_idx on public.fiscal_settings(tenant_id);
create index if not exists product_fiscal_profiles_tenant_product_idx on public.product_fiscal_profiles(tenant_id,product_id);
create index if not exists fiscal_documents_tenant_status_idx on public.fiscal_documents(tenant_id,status,created_at desc);
create index if not exists fiscal_documents_order_idx on public.fiscal_documents(order_id);
create index if not exists fiscal_document_items_document_idx on public.fiscal_document_items(fiscal_document_id);
create index if not exists fiscal_document_items_order_item_idx on public.fiscal_document_items(order_item_id);
create index if not exists fiscal_document_items_product_idx on public.fiscal_document_items(product_id);
create index if not exists fiscal_document_events_document_idx on public.fiscal_document_events(fiscal_document_id,created_at desc);

alter table public.fiscal_settings enable row level security;
alter table public.product_fiscal_profiles enable row level security;
alter table public.fiscal_documents enable row level security;
alter table public.fiscal_document_items enable row level security;
alter table public.fiscal_document_events enable row level security;

do $$
declare t text;
begin
 foreach t in array array['fiscal_settings','product_fiscal_profiles','fiscal_documents','fiscal_document_items','fiscal_document_events'] loop
  execute format('drop policy if exists %I on public.%I',t||'_select',t);
  execute format('create policy %I on public.%I for select to authenticated using((select private.has_tenant_role(tenant_id,null)))',t||'_select',t);
 end loop;
end$$;

grant select on public.fiscal_settings,public.product_fiscal_profiles,public.fiscal_documents,public.fiscal_document_items,public.fiscal_document_events to authenticated;
grant all on public.fiscal_settings,public.product_fiscal_profiles,public.fiscal_documents,public.fiscal_document_items,public.fiscal_document_events to service_role;
revoke all on public.fiscal_settings,public.product_fiscal_profiles,public.fiscal_documents,public.fiscal_document_items,public.fiscal_document_events from anon;

create or replace function public.create_fiscal_draft_from_order(p_order_id uuid,p_model text default '55')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_tenant uuid;v_order public.orders;v_settings public.fiscal_settings;v_doc uuid;v_number integer;v_series integer;v_missing int;v_org uuid;
begin
 if v_user is null then raise exception 'Não autenticado';end if;
 if p_model not in('55','65') then raise exception 'Modelo fiscal inválido';end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if v_order.id is null then raise exception 'Pedido não encontrado';end if;
 v_tenant:=v_order.tenant_id;
 if not exists(select 1 from public.tenant_memberships where user_id=v_user and tenant_id=v_tenant and active and role in('owner','admin','manager')) then raise exception 'Usuário sem permissão fiscal';end if;
 if v_order.status::text not in('pago','faturado','enviado','entregue') then raise exception 'Somente venda paga pode gerar documento fiscal';end if;
 if exists(select 1 from public.fiscal_documents where tenant_id=v_tenant and order_id=p_order_id and model=p_model and status<>'cancelled') then
  return(select jsonb_build_object('ok',true,'reused',true,'document_id',id,'status',status) from public.fiscal_documents where tenant_id=v_tenant and order_id=p_order_id and model=p_model and status<>'cancelled' limit 1);
 end if;
 select * into v_settings from public.fiscal_settings where tenant_id=v_tenant and enabled order by branch_id limit 1 for update;
 if v_settings.id is null then raise exception 'Configuração fiscal ativa não encontrada';end if;
 if p_model='65' and (v_settings.csc_id is null or v_settings.csc_secret_ref is null) then raise exception 'CSC da NFC-e não configurado';end if;
 select count(*) into v_missing from public.order_items oi left join public.product_fiscal_profiles pf on pf.tenant_id=oi.tenant_id and pf.product_id=oi.product_id where oi.order_id=p_order_id and (oi.product_id is null or pf.id is null);
 if v_missing>0 then raise exception '% item(ns) sem perfil fiscal/NCM',v_missing;end if;
 if p_model='55' then v_number:=v_settings.next_nfe_number;v_series:=v_settings.nfe_series;update public.fiscal_settings set next_nfe_number=next_nfe_number+1,updated_by=v_user where id=v_settings.id;
 else v_number:=v_settings.next_nfce_number;v_series:=v_settings.nfce_series;update public.fiscal_settings set next_nfce_number=next_nfce_number+1,updated_by=v_user where id=v_settings.id;end if;

 insert into public.fiscal_documents(tenant_id,branch_id,order_id,model,environment,series,number,status,recipient_name,recipient_tax_id,recipient_email,recipient_phone,recipient_address,totals,tax_totals,provider,created_by)
 values(v_tenant,v_settings.branch_id,p_order_id,p_model,v_settings.environment,v_series,v_number,'draft',v_order.customer_name,v_order.customer_document,v_order.customer_email,v_order.customer_phone,
 jsonb_build_object('zip',v_order.shipping_zip,'street',v_order.shipping_street,'number',v_order.shipping_number,'complement',v_order.shipping_complement,'district',v_order.shipping_neighborhood,'city',v_order.shipping_city,'state',v_order.shipping_state),
 jsonb_build_object('subtotal',v_order.subtotal,'shipping',v_order.shipping,'discount',v_order.discount,'total',v_order.total),'{}'::jsonb,v_settings.provider,v_user) returning id into v_doc;

 insert into public.fiscal_document_items(tenant_id,fiscal_document_id,order_item_id,product_id,line_number,sku,description,gtin,ncm,cest,cfop,quantity,unit_value,gross_value,discount_value,net_value,tax_snapshot)
 select v_tenant,v_doc,oi.id,oi.product_id,row_number()over(order by oi.id),oi.sku,oi.name,p.gtin,pf.ncm,pf.cest,
 case when v_order.shipping_state=v_settings.state then pf.cfop_in_state else pf.cfop_out_state end,
 oi.quantity,oi.unit_price,oi.total,0,oi.total,
 jsonb_build_object('origin',pf.origin,'icms_cst',pf.icms_cst,'icms_csosn',pf.icms_csosn,'icms_rate',pf.icms_rate,
 'pis_cst',pf.pis_cst,'pis_rate',pf.pis_rate,'cofins_cst',pf.cofins_cst,'cofins_rate',pf.cofins_rate,
 'ibs_cst',pf.ibs_cst,'ibs_classification',pf.ibs_classification,'ibs_rate',pf.ibs_rate,
 'cbs_cst',pf.cbs_cst,'cbs_classification',pf.cbs_classification,'cbs_rate',pf.cbs_rate)
 from public.order_items oi join public.products p on p.id=oi.product_id and p.tenant_id=oi.tenant_id join public.product_fiscal_profiles pf on pf.product_id=oi.product_id and pf.tenant_id=oi.tenant_id where oi.order_id=p_order_id order by oi.id;

 insert into public.fiscal_document_events(tenant_id,fiscal_document_id,event_type,message,payload,created_by)
 values(v_tenant,v_doc,'created','Rascunho fiscal criado a partir da venda',jsonb_build_object('order_id',p_order_id,'model',p_model),v_user);
 select organization_id into v_org from public.tenants where id=v_tenant;
 insert into public.audit_events(organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data)
 values(v_org,v_tenant,v_user,'fiscal.document_created','fiscal_document',v_doc::text,jsonb_build_object('model',p_model,'series',v_series,'number',v_number,'order_id',p_order_id));
 return jsonb_build_object('ok',true,'reused',false,'document_id',v_doc,'status','draft','series',v_series,'number',v_number);
end$$;

revoke all on function public.create_fiscal_draft_from_order(uuid,text) from public,anon;
grant execute on function public.create_fiscal_draft_from_order(uuid,text) to authenticated,service_role;

commit;