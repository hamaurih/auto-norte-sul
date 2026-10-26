-- Consolidate obvious duplicate brand spellings for the Norte Sul tenant.
-- Product relationships are repointed before duplicate rows are removed.
-- Alternate spellings remain searchable through aliases.

do $$
declare
  v_tenant uuid := '87fee723-b111-411e-827e-ea6e67fd29ae'::uuid;
begin
  -- AUTO PLAST <- AUTOPLAST
  update public.products set brand_id='613ae51a-0713-48eb-b450-542c6beb3052'
  where tenant_id=v_tenant and brand_id='117ac8c7-fa58-48b7-a7b0-8d1c569e0a09';
  delete from public.brands where tenant_id=v_tenant and id='117ac8c7-fa58-48b7-a7b0-8d1c569e0a09';

  -- AUTO QUALITY <- AUTOQUALITY
  update public.products set brand_id='fb16d970-80e4-4205-a88f-83445ab393c4'
  where tenant_id=v_tenant and brand_id='927d33e0-4a34-4afb-a823-d011f152442a';
  delete from public.brands where tenant_id=v_tenant and id='927d33e0-4a34-4afb-a823-d011f152442a';

  -- FIRST OPTION <- FIRSTOPTION
  update public.products set brand_id='587d98d4-28f3-4fdb-9207-ead2f3e5d8f8'
  where tenant_id=v_tenant and brand_id='20c9782f-5407-47dd-be2b-a8a2562ad47b';
  delete from public.brands where tenant_id=v_tenant and id='20c9782f-5407-47dd-be2b-a8a2562ad47b';

  -- KITGLASS <- KIT GLASS
  update public.products set brand_id='fd1ec0b2-bacc-4371-8283-97aceb54b91f'
  where tenant_id=v_tenant and brand_id='4b0a5b97-152e-426e-a921-6346e8c54abd';
  delete from public.brands where tenant_id=v_tenant and id='4b0a5b97-152e-426e-a921-6346e8c54abd';

  -- KJ: preserve populated row, normalize slug after deleting empty duplicate.
  update public.products set brand_id='03b860a2-192b-467b-afd7-6713b503794c'
  where tenant_id=v_tenant and brand_id='0f15d281-a620-414d-9cc7-3a892e8412e8';
  delete from public.brands where tenant_id=v_tenant and id='0f15d281-a620-414d-9cc7-3a892e8412e8';
  update public.brands set slug='kj'
  where tenant_id=v_tenant and id='03b860a2-192b-467b-afd7-6713b503794c';

  -- PLAST CAR <- PLASTCAR
  update public.products set brand_id='d65ffad6-ff53-4b79-a4a2-a94b6b4b0314'
  where tenant_id=v_tenant and brand_id='1d4f4b4f-b32c-4f5c-bf8d-6e44c08067fd';
  delete from public.brands where tenant_id=v_tenant and id='1d4f4b4f-b32c-4f5c-bf8d-6e44c08067fd';

  -- TECH ONE <- TECHONE
  update public.products set brand_id='ffa36073-4bca-4171-a1b7-f18f8113cc75'
  where tenant_id=v_tenant and brand_id='76b517a0-d26c-4633-83f2-1f5be9ff2f18';
  delete from public.brands where tenant_id=v_tenant and id='76b517a0-d26c-4633-83f2-1f5be9ff2f18';

  -- TOP MIX <- TopMix
  update public.products set brand_id='a5836d9c-2be6-4aa4-85ba-534816042664'
  where tenant_id=v_tenant and brand_id='952b3cdc-5fd1-4122-9149-c79a6642aed7';
  delete from public.brands where tenant_id=v_tenant and id='952b3cdc-5fd1-4122-9149-c79a6642aed7';

  insert into public.search_aliases
    (tenant_id,term,normalized_term,target_type,target_id,target_slug,target_label,weight,is_active)
  values
    (v_tenant,'AUTOPLAST','autoplast','brand','613ae51a-0713-48eb-b450-542c6beb3052','auto-plast','AUTO PLAST',100,true),
    (v_tenant,'AUTOQUALITY','autoquality','brand','fb16d970-80e4-4205-a88f-83445ab393c4','auto-quality','AUTO QUALITY',100,true),
    (v_tenant,'FIRSTOPTION','firstoption','brand','587d98d4-28f3-4fdb-9207-ead2f3e5d8f8','first-option','FIRST OPTION',100,true),
    (v_tenant,'KIT GLASS','kit glass','brand','fd1ec0b2-bacc-4371-8283-97aceb54b91f','kitglass','KITGLASS',100,true),
    (v_tenant,'PLASTCAR','plastcar','brand','d65ffad6-ff53-4b79-a4a2-a94b6b4b0314','plast-car','PLAST CAR',100,true),
    (v_tenant,'TECHONE','techone','brand','ffa36073-4bca-4171-a1b7-f18f8113cc75','tech-one','TECH ONE',100,true),
    (v_tenant,'TOPMIX','topmix','brand','a5836d9c-2be6-4aa4-85ba-534816042664','top-mix','TOP MIX',100,true)
  on conflict (tenant_id,normalized_term,target_type,target_slug)
  do update set
    target_id=excluded.target_id,
    target_label=excluded.target_label,
    weight=greatest(public.search_aliases.weight,excluded.weight),
    is_active=true,
    updated_at=now();
end $$;
