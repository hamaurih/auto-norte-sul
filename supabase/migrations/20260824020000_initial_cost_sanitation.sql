begin;

alter table public.product_cost_history drop constraint if exists product_cost_history_source_check;
alter table public.product_cost_history add constraint product_cost_history_source_check
check (source in ('goods_receipt','goods_receipt_reversal','manual','cost_sanitation')) not valid;
alter table public.product_cost_history validate constraint product_cost_history_source_check;

create table if not exists public.product_cost_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  proposed_cost numeric(14,4),
  source_type text not null check(source_type in ('nfe_xml','goods_receipt','purchase_order','bling','spreadsheet','manual','missing')),
  source_reference text,
  source_date timestamptz,
  confidence text not null default 'none' check(confidence in ('high','medium','low','none')),
  status text not null default 'awaiting_source' check(status in ('awaiting_source','pending','approved','rejected')),
  evidence jsonb not null default '{}'::jsonb,
  notes text,
  current_price numeric(14,2),
  suggested_price numeric(14,2),
  projected_margin_rate numeric(9,6),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_cost_candidates_product_tenant_fkey
    foreign key(product_id,tenant_id) references public.products(id,tenant_id) on delete cascade,
  constraint product_cost_candidates_cost_check check(proposed_cost is null or proposed_cost>0)
);

create unique index if not exists product_cost_candidates_open_unique
on public.product_cost_candidates(tenant_id,product_id)
where status in ('awaiting_source','pending');
create index if not exists product_cost_candidates_tenant_status_idx
on public.product_cost_candidates(tenant_id,status,updated_at desc);
create index if not exists product_cost_candidates_product_idx on public.product_cost_candidates(product_id);

alter table public.product_cost_candidates enable row level security;
drop policy if exists product_cost_candidates_select_members on public.product_cost_candidates;
create policy product_cost_candidates_select_members on public.product_cost_candidates for select to authenticated
using((select private.has_tenant_role(tenant_id,null)));
grant select on public.product_cost_candidates to authenticated;
grant all on public.product_cost_candidates to service_role;
revoke all on public.product_cost_candidates from anon;

create or replace function private.cost_suggested_price(
 p_tenant uuid,p_product uuid,p_cost numeric
) returns numeric language sql stable security definer set search_path='' as $$
 select case
  when p_cost is null or p_cost<=0 or s.desired_margin_rate is null then null
  when 1-(coalesce(s.tax_rate,0)+coalesce(s.commission_rate,0)+coalesce(s.payment_fee_rate,0)+coalesce(s.other_variable_rate,0)+s.desired_margin_rate)<=0 then null
  else round((p_cost+coalesce(s.fixed_cost_per_unit,0))/
    (1-(coalesce(s.tax_rate,0)+coalesce(s.commission_rate,0)+coalesce(s.payment_fee_rate,0)+coalesce(s.other_variable_rate,0)+s.desired_margin_rate)),2)
 end
 from public.product_pricing_settings s where s.tenant_id=p_tenant and s.product_id=p_product
$$;
revoke all on function private.cost_suggested_price(uuid,uuid,numeric) from public;

create or replace function public.refresh_cost_sanitation_queue()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_tenant uuid;v_count int:=0;
begin
 if v_user is null then raise exception 'Não autenticado';end if;
 select tenant_id into v_tenant from public.tenant_memberships
 where user_id=v_user and active and role in('owner','admin','manager','stock') order by created_at limit 1;
 if v_tenant is null then raise exception 'Usuário sem permissão';end if;

 insert into public.product_cost_candidates(
  tenant_id,product_id,proposed_cost,source_type,source_reference,source_date,confidence,status,evidence,
  current_price,suggested_price,projected_margin_rate,created_by)
 select v_tenant,p.id,src.cost,coalesce(src.source_type,'missing'),src.reference,src.source_date,
  case when src.source_type in('nfe_xml','goods_receipt') then 'high' when src.source_type='purchase_order' then 'medium' else 'none' end,
  case when src.cost>0 then 'pending' else 'awaiting_source' end,
  coalesce(src.evidence,'{}'::jsonb),p.price_b2c,
  private.cost_suggested_price(v_tenant,p.id,src.cost),
  case when src.cost>0 and p.price_b2c>0 then round((p.price_b2c-src.cost)/p.price_b2c,6) else null end,v_user
 from public.products p
 left join lateral (
   select x.cost,x.source_type,x.reference,x.source_date,x.evidence from (
    select ni.unit_value+(coalesce(ni.freight_amount,0)+coalesce(ni.other_amount,0)-coalesce(ni.discount_amount,0))/nullif(ni.qty,0) cost,
      'nfe_xml'::text source_type,'NF-e '||coalesce(n.nfe_number::text,n.access_key) reference,
      coalesce(n.issued_at,n.created_at) source_date,jsonb_build_object('nfe_import_id',n.id,'item_id',ni.id) evidence,1 priority
    from public.nfe_import_items ni join public.nfe_imports n on n.id=ni.nfe_import_id
    where ni.tenant_id=v_tenant and ni.product_id=p.id and ni.qty>0 and ni.unit_value>0 and n.status<>'cancelled'
    union all
    select ri.acquisition_unit_cost,'goods_receipt','Recebimento #'||r.number,r.confirmed_at,
      jsonb_build_object('goods_receipt_id',r.id,'item_id',ri.id),2
    from public.goods_receipt_items ri join public.goods_receipts r on r.id=ri.goods_receipt_id
    where ri.tenant_id=v_tenant and ri.product_id=p.id and ri.acquisition_unit_cost>0 and r.status='confirmed'
    union all
    select oi.unit_cost,'purchase_order','Pedido #'||o.number,o.created_at,
      jsonb_build_object('purchase_order_id',o.id,'item_id',oi.id),3
    from public.purchase_order_items oi join public.purchase_orders o on o.id=oi.purchase_order_id
    where oi.tenant_id=v_tenant and oi.product_id=p.id and oi.unit_cost>0 and o.status<>'cancelled'
   )x order by priority,source_date desc limit 1
 )src on true
 where p.tenant_id=v_tenant and p.stock>0 and p.average_cost is null
 on conflict(tenant_id,product_id) where status in('awaiting_source','pending')
 do update set proposed_cost=excluded.proposed_cost,source_type=excluded.source_type,
 source_reference=excluded.source_reference,source_date=excluded.source_date,confidence=excluded.confidence,
 status=excluded.status,evidence=excluded.evidence,current_price=excluded.current_price,
 suggested_price=excluded.suggested_price,projected_margin_rate=excluded.projected_margin_rate,updated_at=now();
 get diagnostics v_count=row_count;
 return jsonb_build_object('ok',true,'processed',v_count);
end$$;

create or replace function public.propose_manual_product_cost(
 p_product_id uuid,p_cost numeric,p_evidence_reference text,p_notes text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_tenant uuid;v_id uuid;v_price numeric;
begin
 if p_cost is null or p_cost<=0 then raise exception 'Custo deve ser maior que zero';end if;
 if length(btrim(coalesce(p_evidence_reference,'')))<3 then raise exception 'Informe a evidência do custo';end if;
 select tenant_id into v_tenant from public.tenant_memberships where user_id=v_user and active and role in('owner','admin','manager','stock') order by created_at limit 1;
 if v_tenant is null or not exists(select 1 from public.products where id=p_product_id and tenant_id=v_tenant) then raise exception 'Produto ou permissão inválida';end if;
 select price_b2c into v_price from public.products where id=p_product_id;
 insert into public.product_cost_candidates(tenant_id,product_id,proposed_cost,source_type,source_reference,source_date,confidence,status,evidence,notes,current_price,suggested_price,projected_margin_rate,created_by)
 values(v_tenant,p_product_id,p_cost,'manual',btrim(p_evidence_reference),now(),'medium','pending',
 jsonb_build_object('declared_by',v_user),nullif(btrim(coalesce(p_notes,'')),''),v_price,
 private.cost_suggested_price(v_tenant,p_product_id,p_cost),
 case when v_price>0 then round((v_price-p_cost)/v_price,6) end,v_user)
 on conflict(tenant_id,product_id) where status in('awaiting_source','pending')
 do update set proposed_cost=excluded.proposed_cost,source_type='manual',source_reference=excluded.source_reference,
 source_date=now(),confidence='medium',status='pending',evidence=excluded.evidence,notes=excluded.notes,
 current_price=excluded.current_price,suggested_price=excluded.suggested_price,
 projected_margin_rate=excluded.projected_margin_rate,updated_at=now()
 returning id into v_id;
 return jsonb_build_object('ok',true,'candidate_id',v_id);
end$$;

create or replace function public.approve_product_cost_candidates(p_candidate_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_tenant uuid;v_row record;v_count int:=0;v_org uuid;
begin
 if coalesce(array_length(p_candidate_ids,1),0)=0 then raise exception 'Selecione ao menos um custo';end if;
 select tenant_id into v_tenant from public.tenant_memberships where user_id=v_user and active and role in('owner','admin','manager') order by created_at limit 1;
 if v_tenant is null then raise exception 'Usuário sem permissão para aprovar';end if;
 select organization_id into v_org from public.tenants where id=v_tenant;
 for v_row in select c.*,p.average_cost,p.last_purchase_cost from public.product_cost_candidates c
  join public.products p on p.id=c.product_id and p.tenant_id=c.tenant_id
  where c.tenant_id=v_tenant and c.id=any(p_candidate_ids) and c.status='pending' and c.proposed_cost>0
  order by c.product_id for update of c,p
 loop
  update public.products set average_cost=v_row.proposed_cost,last_purchase_cost=coalesce(last_purchase_cost,v_row.proposed_cost),updated_at=now()
  where id=v_row.product_id and tenant_id=v_tenant;
  insert into public.product_cost_history(tenant_id,product_id,source,reference_id,qty,unit_cost,
   previous_average_cost,new_average_cost,previous_last_cost,new_last_cost,created_by)
  values(v_tenant,v_row.product_id,'cost_sanitation',v_row.id,0,v_row.proposed_cost,
   v_row.average_cost,v_row.proposed_cost,v_row.last_purchase_cost,coalesce(v_row.last_purchase_cost,v_row.proposed_cost),v_user);
  update public.product_cost_candidates set status='approved',reviewed_by=v_user,reviewed_at=now(),updated_at=now() where id=v_row.id;
  insert into public.audit_events(organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,before_data,after_data,metadata)
  values(v_org,v_tenant,v_user,'product.cost_sanitized','product',v_row.product_id::text,
   jsonb_build_object('average_cost',v_row.average_cost),jsonb_build_object('average_cost',v_row.proposed_cost),
   jsonb_build_object('candidate_id',v_row.id,'source_type',v_row.source_type,'source_reference',v_row.source_reference));
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('ok',true,'approved',v_count);
end$$;

revoke all on function public.refresh_cost_sanitation_queue() from public,anon;
revoke all on function public.propose_manual_product_cost(uuid,numeric,text,text) from public,anon;
revoke all on function public.approve_product_cost_candidates(uuid[]) from public,anon;
grant execute on function public.refresh_cost_sanitation_queue() to authenticated,service_role;
grant execute on function public.propose_manual_product_cost(uuid,numeric,text,text) to authenticated,service_role;
grant execute on function public.approve_product_cost_candidates(uuid[]) to authenticated,service_role;

commit;