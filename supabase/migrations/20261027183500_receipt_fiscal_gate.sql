begin;

create or replace function private.create_fiscal_draft_from_receipt(
  p_receipt_id uuid,
  p_model text default '55'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_receipt public.sales_receipts;
  v_settings public.fiscal_settings;
  v_latest_decision text;
  v_doc uuid;
  v_number integer;
  v_series integer;
  v_missing integer;
  v_org uuid;
  v_shipping_state text;
  v_item jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_model not in ('55','65') then raise exception 'INVALID_FISCAL_MODEL'; end if;

  select * into v_receipt
  from public.sales_receipts
  where id=p_receipt_id;

  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.tenant_memberships tm
    where tm.tenant_id=v_receipt.tenant_id
      and tm.user_id=v_user
      and tm.active
      and tm.role in ('owner','admin','manager','sales')
  ) then raise exception 'FORBIDDEN'; end if;

  select d.decision into v_latest_decision
  from public.receipt_fiscal_decisions d
  where d.tenant_id=v_receipt.tenant_id
    and d.receipt_id=v_receipt.id
  order by d.created_at desc,d.id desc
  limit 1;

  if v_latest_decision is distinct from 'request_invoice' then
    raise exception 'FISCAL_EMISSION_NOT_REQUESTED';
  end if;

  if exists (
    select 1
    from public.fiscal_documents fd
    where fd.tenant_id=v_receipt.tenant_id
      and fd.receipt_id=v_receipt.id
      and fd.model=p_model
      and fd.status<>'cancelled'
  ) then
    return (
      select jsonb_build_object(
        'ok',true,'reused',true,'document_id',fd.id,'status',fd.status,
        'series',fd.series,'number',fd.number,'receipt_id',v_receipt.id
      )
      from public.fiscal_documents fd
      where fd.tenant_id=v_receipt.tenant_id
        and fd.receipt_id=v_receipt.id
        and fd.model=p_model
        and fd.status<>'cancelled'
      order by fd.created_at desc
      limit 1
    );
  end if;

  select * into v_settings
  from public.fiscal_settings fs
  where fs.tenant_id=v_receipt.tenant_id and fs.enabled
  order by fs.branch_id
  limit 1
  for update;

  if v_settings.id is null then raise exception 'FISCAL_SETTINGS_NOT_FOUND'; end if;
  if p_model='65' and (v_settings.csc_id is null or v_settings.csc_secret_ref is null) then
    raise exception 'NFCE_CSC_NOT_CONFIGURED';
  end if;

  select count(*) into v_missing
  from jsonb_array_elements(v_receipt.items_snapshot) j(item)
  left join public.product_fiscal_profiles pf
    on pf.tenant_id=v_receipt.tenant_id
   and pf.product_id=(j.item->>'product_id')::uuid
  where nullif(j.item->>'product_id','') is null or pf.id is null;

  if v_missing>0 then raise exception 'FISCAL_PROFILE_MISSING:%',v_missing; end if;

  if p_model='55' then
    v_number:=v_settings.next_nfe_number;
    v_series:=v_settings.nfe_series;
    update public.fiscal_settings
    set next_nfe_number=next_nfe_number+1,updated_by=v_user
    where id=v_settings.id;
  else
    v_number:=v_settings.next_nfce_number;
    v_series:=v_settings.nfce_series;
    update public.fiscal_settings
    set next_nfce_number=next_nfce_number+1,updated_by=v_user
    where id=v_settings.id;
  end if;

  v_shipping_state:=v_receipt.customer_snapshot#>>'{shipping,state}';

  insert into public.fiscal_documents(
    tenant_id,branch_id,order_id,receipt_id,model,environment,series,number,status,
    recipient_name,recipient_tax_id,recipient_email,recipient_phone,recipient_address,
    totals,tax_totals,provider,created_by
  )
  values(
    v_receipt.tenant_id,
    v_settings.branch_id,
    v_receipt.order_id,
    v_receipt.id,
    p_model,
    v_settings.environment,
    v_series,
    v_number,
    'draft',
    coalesce(v_receipt.customer_snapshot->>'name','Cliente'),
    nullif(v_receipt.customer_snapshot->>'document',''),
    nullif(v_receipt.customer_snapshot->>'email',''),
    nullif(v_receipt.customer_snapshot->>'phone',''),
    coalesce(v_receipt.customer_snapshot->'shipping','{}'::jsonb),
    jsonb_build_object(
      'subtotal',(v_receipt.sale_snapshot->>'subtotal')::numeric,
      'shipping',(v_receipt.sale_snapshot->>'shipping')::numeric,
      'discount',(v_receipt.sale_snapshot->>'discount')::numeric,
      'total',(v_receipt.sale_snapshot->>'total')::numeric
    ),
    '{}'::jsonb,
    v_settings.provider,
    v_user
  )
  returning id into v_doc;

  insert into public.fiscal_document_items(
    tenant_id,fiscal_document_id,order_item_id,product_id,line_number,
    sku,description,gtin,ncm,cest,cfop,quantity,unit_value,gross_value,
    discount_value,net_value,tax_snapshot
  )
  select
    v_receipt.tenant_id,
    v_doc,
    nullif(j.item->>'order_item_id','')::uuid,
    (j.item->>'product_id')::uuid,
    j.ord::integer,
    coalesce(j.item->>'sku',''),
    coalesce(j.item->>'name','Produto'),
    p.gtin,
    pf.ncm,
    pf.cest,
    case when coalesce(v_shipping_state,v_settings.state)=v_settings.state
      then pf.cfop_in_state else pf.cfop_out_state end,
    (j.item->>'quantity')::numeric,
    (j.item->>'unit_price')::numeric,
    (j.item->>'line_total')::numeric + coalesce((j.item->>'discount_amount')::numeric,0),
    coalesce((j.item->>'discount_amount')::numeric,0),
    (j.item->>'line_total')::numeric,
    jsonb_build_object(
      'origin',pf.origin,
      'icms_cst',pf.icms_cst,
      'icms_csosn',pf.icms_csosn,
      'icms_rate',pf.icms_rate,
      'pis_cst',pf.pis_cst,
      'pis_rate',pf.pis_rate,
      'cofins_cst',pf.cofins_cst,
      'cofins_rate',pf.cofins_rate,
      'ibs_cst',pf.ibs_cst,
      'ibs_classification',pf.ibs_classification,
      'ibs_rate',pf.ibs_rate,
      'cbs_cst',pf.cbs_cst,
      'cbs_classification',pf.cbs_classification,
      'cbs_rate',pf.cbs_rate,
      'receipt_snapshot_hash',v_receipt.snapshot_hash
    )
  from jsonb_array_elements(v_receipt.items_snapshot) with ordinality j(item,ord)
  join public.products p
    on p.id=(j.item->>'product_id')::uuid
   and p.tenant_id=v_receipt.tenant_id
  join public.product_fiscal_profiles pf
    on pf.product_id=p.id
   and pf.tenant_id=p.tenant_id
  order by j.ord;

  insert into public.fiscal_document_events(
    tenant_id,fiscal_document_id,event_type,message,payload,created_by
  )
  values(
    v_receipt.tenant_id,v_doc,'created',
    'Rascunho fiscal criado a partir do recibo imutável',
    jsonb_build_object(
      'receipt_id',v_receipt.id,
      'receipt_code',v_receipt.receipt_code,
      'snapshot_hash',v_receipt.snapshot_hash,
      'order_id',v_receipt.order_id,
      'model',p_model
    ),
    v_user
  );

  select organization_id into v_org
  from public.tenants
  where id=v_receipt.tenant_id;

  insert into public.audit_events(
    organization_id,tenant_id,actor_user_id,action,resource_type,resource_id,after_data
  )
  values(
    v_org,v_receipt.tenant_id,v_user,
    'fiscal.document_created_from_receipt',
    'fiscal_document',v_doc::text,
    jsonb_build_object(
      'receipt_id',v_receipt.id,
      'receipt_code',v_receipt.receipt_code,
      'snapshot_hash',v_receipt.snapshot_hash,
      'model',p_model,
      'series',v_series,
      'number',v_number
    )
  );

  return jsonb_build_object(
    'ok',true,'reused',false,'document_id',v_doc,'status','draft',
    'series',v_series,'number',v_number,'receipt_id',v_receipt.id
  );
end
$$;

revoke all on function private.create_fiscal_draft_from_receipt(uuid,text)
from public,anon,authenticated;
grant execute on function private.create_fiscal_draft_from_receipt(uuid,text) to service_role;

create or replace function public.create_fiscal_draft_from_receipt(
  p_receipt_id uuid,
  p_model text default '55'
)
returns jsonb
language sql
security definer
set search_path=''
as $$
  select private.create_fiscal_draft_from_receipt($1,$2);
$$;

revoke all on function public.create_fiscal_draft_from_receipt(uuid,text)
from public,anon;
grant execute on function public.create_fiscal_draft_from_receipt(uuid,text)
to authenticated,service_role;

-- The old order-based public entry point is no longer available to users.
revoke execute on function public.create_fiscal_draft_from_order(uuid,text)
from authenticated;
revoke execute on function private.create_fiscal_draft_from_order(uuid,text)
from authenticated;

commit;