-- Formação de preço Norte Sul: preço existente = B2B base; B2C derivado por markup global ou exceção individual.

create table if not exists public.tenant_pricing_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  default_b2c_markup_pct numeric(7,2) not null default 0 check (default_b2c_markup_pct between 0 and 1000),
  price_rounding text not null default 'cent' check (price_rounding in ('cent','x90','x99','whole')),
  auto_recalculate_b2c boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_b2c_price_rules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  mode text not null default 'global' check (mode in ('global','markup','manual')),
  markup_pct numeric(7,2),
  manual_b2c_price numeric(14,2),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,product_id),
  foreign key (product_id,tenant_id) references public.products(id,tenant_id) on delete cascade,
  check (
    (mode='global' and markup_pct is null and manual_b2c_price is null)
    or (mode='markup' and markup_pct between 0 and 1000 and manual_b2c_price is null)
    or (mode='manual' and manual_b2c_price >= 0 and markup_pct is null)
  )
);

create table if not exists public.price_adjustment_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null unique,
  target text not null check (target in ('b2b','b2c')),
  adjustment_pct numeric(8,2) not null,
  brand_id uuid,
  category_id uuid,
  only_active boolean not null default true,
  affected_count integer not null default 0,
  average_before numeric(14,2),
  average_after numeric(14,2),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists product_b2c_price_rules_tenant_mode_idx on public.product_b2c_price_rules(tenant_id,mode);
create index if not exists price_adjustment_batches_tenant_created_idx on public.price_adjustment_batches(tenant_id,created_at desc);

alter table public.tenant_pricing_settings enable row level security;
alter table public.product_b2c_price_rules enable row level security;
alter table public.price_adjustment_batches enable row level security;

revoke all on public.tenant_pricing_settings,public.product_b2c_price_rules,public.price_adjustment_batches from anon,authenticated;
grant select,insert,update,delete on public.tenant_pricing_settings,public.product_b2c_price_rules to authenticated;
grant select on public.price_adjustment_batches to authenticated;
grant all on public.tenant_pricing_settings,public.product_b2c_price_rules,public.price_adjustment_batches to service_role;

drop policy if exists tenant_pricing_settings_read on public.tenant_pricing_settings;
create policy tenant_pricing_settings_read on public.tenant_pricing_settings for select to authenticated using (private.has_tenant_role(tenant_id));
drop policy if exists tenant_pricing_settings_write on public.tenant_pricing_settings;
create policy tenant_pricing_settings_write on public.tenant_pricing_settings for all to authenticated using (private.has_tenant_role(tenant_id,array['owner','admin','manager'])) with check (private.has_tenant_role(tenant_id,array['owner','admin','manager']));
drop policy if exists product_b2c_price_rules_read on public.product_b2c_price_rules;
create policy product_b2c_price_rules_read on public.product_b2c_price_rules for select to authenticated using (private.has_tenant_role(tenant_id));
drop policy if exists product_b2c_price_rules_write on public.product_b2c_price_rules;
create policy product_b2c_price_rules_write on public.product_b2c_price_rules for all to authenticated using (private.has_tenant_role(tenant_id,array['owner','admin','manager'])) with check (private.has_tenant_role(tenant_id,array['owner','admin','manager']));
drop policy if exists price_adjustment_batches_read on public.price_adjustment_batches;
create policy price_adjustment_batches_read on public.price_adjustment_batches for select to authenticated using (private.has_tenant_role(tenant_id,array['owner','admin','manager']));

insert into public.tenant_pricing_settings(tenant_id) select id from public.tenants on conflict(tenant_id) do nothing;

-- Cutover sem mudança visual: o preço trazido do Bling era B2B. B2C permanece igual até o administrador definir margem.
update public.products set price_b2b=price_b2c,updated_at=now()
where deleted_at is null and coalesce(price_b2c,0)>0 and coalesce(price_b2b,0)<=0;

create or replace function private.apply_b2c_rounding(p_value numeric,p_rule text)
returns numeric language sql immutable set search_path='' as $$
select case when p_value is null then null when p_rule='x90' then floor(greatest(p_value,0))+0.90 when p_rule='x99' then floor(greatest(p_value,0))+0.99 when p_rule='whole' then ceil(greatest(p_value,0)) else round(greatest(p_value,0),2) end;
$$;
revoke all on function private.apply_b2c_rounding(numeric,text) from public,anon,authenticated;

create or replace function private.compute_b2c_price(p_tenant_id uuid,p_product_id uuid,p_b2b numeric)
returns numeric language plpgsql stable set search_path='' as $$
declare v_global numeric:=0; v_rounding text:='cent'; v_mode text:='global'; v_markup numeric; v_manual numeric;
begin
  if p_b2b is null or p_b2b<0 then return 0; end if;
  select default_b2c_markup_pct,price_rounding into v_global,v_rounding from public.tenant_pricing_settings where tenant_id=p_tenant_id;
  select mode,markup_pct,manual_b2c_price into v_mode,v_markup,v_manual from public.product_b2c_price_rules where tenant_id=p_tenant_id and product_id=p_product_id;
  if not found then v_mode:='global'; end if;
  if v_mode='manual' then return private.apply_b2c_rounding(coalesce(v_manual,0),coalesce(v_rounding,'cent')); end if;
  if v_mode='markup' then return private.apply_b2c_rounding(p_b2b*(1+coalesce(v_markup,0)/100),coalesce(v_rounding,'cent')); end if;
  return private.apply_b2c_rounding(p_b2b*(1+coalesce(v_global,0)/100),coalesce(v_rounding,'cent'));
end; $$;
revoke all on function private.compute_b2c_price(uuid,uuid,numeric) from public,anon,authenticated;

create or replace function private.sync_b2c_from_b2b()
returns trigger language plpgsql set search_path='' as $$
declare v_auto boolean:=true;
begin
  if coalesce(new.price_b2b,0)<=0 and coalesce(new.price_b2c,0)>0 then new.price_b2b:=new.price_b2c; end if;
  select auto_recalculate_b2c into v_auto from public.tenant_pricing_settings where tenant_id=new.tenant_id;
  if coalesce(v_auto,true) then new.price_b2c:=private.compute_b2c_price(new.tenant_id,new.id,coalesce(new.price_b2b,0)); end if;
  return new;
end; $$;
revoke all on function private.sync_b2c_from_b2b() from public,anon,authenticated;
drop trigger if exists trg_sync_b2c_from_b2b on public.products;
create trigger trg_sync_b2c_from_b2b before insert or update of price_b2b,price_b2c on public.products for each row execute function private.sync_b2c_from_b2b();

create or replace function public.set_global_b2c_markup(p_tenant_id uuid,p_markup_pct numeric,p_rounding text default 'cent',p_recalculate boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_count integer:=0;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if not exists(select 1 from public.tenant_memberships where tenant_id=p_tenant_id and user_id=v_uid and active and role in ('owner','admin','manager')) then raise exception 'Sem permissão'; end if;
  if p_markup_pct<0 or p_markup_pct>1000 then raise exception 'Margem B2C fora do limite'; end if;
  if p_rounding not in ('cent','x90','x99','whole') then raise exception 'Arredondamento inválido'; end if;
  insert into public.tenant_pricing_settings(tenant_id,default_b2c_markup_pct,price_rounding,updated_by,updated_at) values(p_tenant_id,p_markup_pct,p_rounding,v_uid,now())
  on conflict(tenant_id) do update set default_b2c_markup_pct=excluded.default_b2c_markup_pct,price_rounding=excluded.price_rounding,updated_by=v_uid,updated_at=now();
  if p_recalculate then update public.products p set price_b2c=private.compute_b2c_price(p.tenant_id,p.id,coalesce(p.price_b2b,0)),updated_at=now() where p.tenant_id=p_tenant_id and p.deleted_at is null; get diagnostics v_count=row_count; end if;
  return jsonb_build_object('ok',true,'recalculated',v_count,'markup_pct',p_markup_pct,'rounding',p_rounding);
end; $$;
revoke all on function public.set_global_b2c_markup(uuid,numeric,text,boolean) from public,anon;
grant execute on function public.set_global_b2c_markup(uuid,numeric,text,boolean) to authenticated,service_role;

create or replace function public.set_product_b2c_rule(p_tenant_id uuid,p_product_id uuid,p_mode text,p_markup_pct numeric default null,p_manual_price numeric default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_b2b numeric; v_b2c numeric;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if not exists(select 1 from public.tenant_memberships where tenant_id=p_tenant_id and user_id=v_uid and active and role in ('owner','admin','manager')) then raise exception 'Sem permissão'; end if;
  if p_mode not in ('global','markup','manual') then raise exception 'Modo inválido'; end if;
  if p_mode='markup' and (p_markup_pct is null or p_markup_pct<0 or p_markup_pct>1000) then raise exception 'Margem individual inválida'; end if;
  if p_mode='manual' and (p_manual_price is null or p_manual_price<0) then raise exception 'Preço manual inválido'; end if;
  select price_b2b into v_b2b from public.products where id=p_product_id and tenant_id=p_tenant_id and deleted_at is null; if not found then raise exception 'Produto não encontrado'; end if;
  if p_mode='global' then delete from public.product_b2c_price_rules where tenant_id=p_tenant_id and product_id=p_product_id;
  else insert into public.product_b2c_price_rules(tenant_id,product_id,mode,markup_pct,manual_b2c_price,updated_by,updated_at) values(p_tenant_id,p_product_id,p_mode,case when p_mode='markup' then p_markup_pct end,case when p_mode='manual' then p_manual_price end,v_uid,now()) on conflict(tenant_id,product_id) do update set mode=excluded.mode,markup_pct=excluded.markup_pct,manual_b2c_price=excluded.manual_b2c_price,updated_by=v_uid,updated_at=now(); end if;
  v_b2c:=private.compute_b2c_price(p_tenant_id,p_product_id,coalesce(v_b2b,0));
  update public.products set price_b2c=v_b2c,updated_at=now() where id=p_product_id and tenant_id=p_tenant_id;
  return jsonb_build_object('ok',true,'product_id',p_product_id,'mode',p_mode,'price_b2b',v_b2b,'price_b2c',v_b2c);
end; $$;
revoke all on function public.set_product_b2c_rule(uuid,uuid,text,numeric,numeric) from public,anon;
grant execute on function public.set_product_b2c_rule(uuid,uuid,text,numeric,numeric) to authenticated,service_role;

create or replace function public.preview_price_adjustment(p_tenant_id uuid,p_target text,p_percentage numeric,p_brand_id uuid default null,p_category_id uuid default null,p_only_active boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_count integer; v_before numeric; v_after numeric; v_b2c_after numeric; v_sample jsonb;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if not exists(select 1 from public.tenant_memberships where tenant_id=p_tenant_id and user_id=v_uid and active and role in ('owner','admin','manager')) then raise exception 'Sem permissão'; end if;
  if p_target not in ('b2b','b2c') then raise exception 'Alvo inválido'; end if;
  if p_percentage<=-100 or p_percentage>1000 then raise exception 'Percentual fora do limite'; end if;
  with base as (
    select p.*,case when p_target='b2b' then coalesce(p.price_b2b,0) else coalesce(p.price_b2c,0) end before_price from public.products p
    where p.tenant_id=p_tenant_id and p.deleted_at is null and (not p_only_active or p.active) and (p_brand_id is null or p.brand_id=p_brand_id) and (p_category_id is null or p.category_id=p_category_id) and (case when p_target='b2b' then coalesce(p.price_b2b,0)>0 else coalesce(p.price_b2c,0)>0 end)
  ), calc as (
    select b.*,round(before_price*(1+p_percentage/100),2) after_price,case when p_target='b2b' then private.compute_b2c_price(b.tenant_id,b.id,round(before_price*(1+p_percentage/100),2)) else round(before_price*(1+p_percentage/100),2) end calculated_b2c from base b
  )
  select count(*)::int,round(avg(before_price),2),round(avg(after_price),2),round(avg(calculated_b2c),2),coalesce(jsonb_agg(jsonb_build_object('id',id,'sku',sku,'name',name,'before',before_price,'after',after_price,'b2c_after',calculated_b2c) order by name) filter(where rn<=20),'[]'::jsonb)
  into v_count,v_before,v_after,v_b2c_after,v_sample from (select c.*,row_number() over(order by name) rn from calc c) x;
  return jsonb_build_object('ok',true,'affected',coalesce(v_count,0),'average_before',coalesce(v_before,0),'average_after',coalesce(v_after,0),'average_b2c_after',coalesce(v_b2c_after,0),'sample',coalesce(v_sample,'[]'::jsonb));
end; $$;
revoke all on function public.preview_price_adjustment(uuid,text,numeric,uuid,uuid,boolean) from public,anon;
grant execute on function public.preview_price_adjustment(uuid,text,numeric,uuid,uuid,boolean) to authenticated,service_role;

create or replace function public.apply_price_adjustment(p_tenant_id uuid,p_request_id uuid,p_target text,p_percentage numeric,p_brand_id uuid default null,p_category_id uuid default null,p_only_active boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_count integer:=0; v_before numeric:=0; v_after numeric:=0; v_existing uuid;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if not exists(select 1 from public.tenant_memberships where tenant_id=p_tenant_id and user_id=v_uid and active and role in ('owner','admin','manager')) then raise exception 'Sem permissão'; end if;
  if p_target not in ('b2b','b2c') then raise exception 'Alvo inválido'; end if;
  if p_percentage<=-100 or p_percentage>1000 then raise exception 'Percentual fora do limite'; end if;
  select id into v_existing from public.price_adjustment_batches where request_id=p_request_id; if found then return jsonb_build_object('ok',true,'duplicate',true,'batch_id',v_existing); end if;
  select count(*)::int,coalesce(round(avg(case when p_target='b2b' then price_b2b else price_b2c end),2),0) into v_count,v_before from public.products p where p.tenant_id=p_tenant_id and p.deleted_at is null and (not p_only_active or p.active) and (p_brand_id is null or p.brand_id=p_brand_id) and (p_category_id is null or p.category_id=p_category_id) and (case when p_target='b2b' then coalesce(p.price_b2b,0)>0 else coalesce(p.price_b2c,0)>0 end);
  if p_target='b2b' then
    update public.products p set price_b2b=round(p.price_b2b*(1+p_percentage/100),2),updated_at=now() where p.tenant_id=p_tenant_id and p.deleted_at is null and (not p_only_active or p.active) and (p_brand_id is null or p.brand_id=p_brand_id) and (p_category_id is null or p.category_id=p_category_id) and coalesce(p.price_b2b,0)>0;
  else
    insert into public.product_b2c_price_rules(tenant_id,product_id,mode,markup_pct,manual_b2c_price,updated_by,updated_at)
    select p.tenant_id,p.id,'manual',null,round(p.price_b2c*(1+p_percentage/100),2),v_uid,now() from public.products p where p.tenant_id=p_tenant_id and p.deleted_at is null and (not p_only_active or p.active) and (p_brand_id is null or p.brand_id=p_brand_id) and (p_category_id is null or p.category_id=p_category_id) and coalesce(p.price_b2c,0)>0
    on conflict(tenant_id,product_id) do update set mode='manual',markup_pct=null,manual_b2c_price=excluded.manual_b2c_price,updated_by=v_uid,updated_at=now();
    update public.products p set price_b2c=r.manual_b2c_price,updated_at=now() from public.product_b2c_price_rules r where r.tenant_id=p_tenant_id and r.product_id=p.id and r.mode='manual' and p.tenant_id=p_tenant_id and p.deleted_at is null and (not p_only_active or p.active) and (p_brand_id is null or p.brand_id=p_brand_id) and (p_category_id is null or p.category_id=p_category_id);
  end if;
  select coalesce(round(avg(case when p_target='b2b' then price_b2b else price_b2c end),2),0) into v_after from public.products p where p.tenant_id=p_tenant_id and p.deleted_at is null and (not p_only_active or p.active) and (p_brand_id is null or p.brand_id=p_brand_id) and (p_category_id is null or p.category_id=p_category_id) and (case when p_target='b2b' then coalesce(p.price_b2b,0)>0 else coalesce(p.price_b2c,0)>0 end);
  insert into public.price_adjustment_batches(tenant_id,request_id,target,adjustment_pct,brand_id,category_id,only_active,affected_count,average_before,average_after,created_by) values(p_tenant_id,p_request_id,p_target,p_percentage,p_brand_id,p_category_id,p_only_active,v_count,v_before,v_after,v_uid) returning id into v_existing;
  return jsonb_build_object('ok',true,'batch_id',v_existing,'affected',v_count,'average_before',v_before,'average_after',v_after);
end; $$;
revoke all on function public.apply_price_adjustment(uuid,uuid,text,numeric,uuid,uuid,boolean) from public,anon;
grant execute on function public.apply_price_adjustment(uuid,uuid,text,numeric,uuid,uuid,boolean) to authenticated,service_role;
