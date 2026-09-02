-- Integração do piloto automático de enriquecimento.
-- Tudo roda dentro de transação e é revertido ao final.
begin;

do $$
declare
  v_org uuid;
  v_tenant uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_product uuid;
  v_job uuid;
  v_candidate uuid;
  v_first integer;
  v_second integer;
  v_result jsonb;
  v_gtin text;
  v_desc text;
  v_status text;
  v_mode text;
  v_auto boolean;
  v_count integer;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then raise exception 'TEST_FAIL: organization ausente'; end if;

  insert into public.tenants(id, organization_id, name, slug, environment, status)
  values (v_tenant, v_org, 'Autopilot Test Tenant', 'autopilot-test-' || v_suffix, 'sandbox', 'active');

  insert into public.brands(id, tenant_id, name, slug)
  values (v_brand, v_tenant, 'Marca Teste Autopilot', 'marca-teste-' || v_suffix);

  insert into public.manufacturer_catalog_sources(
    tenant_id, brand_id, name, source_kind, base_url, search_url_template,
    allowed_domains, supported_fields, image_usage_note, priority, status
  ) values (
    v_tenant, v_brand, 'Fonte Oficial Teste', 'official_site',
    'https://official-test.example.com', 'https://official-test.example.com/p/{code}',
    array['official-test.example.com'], array['name','description','image','vehicle_application'],
    'Uso de imagem autorizado apenas para teste sintético', 100, 'active'
  );

  -- 1) Enfileiramento idempotente.
  v_product := gen_random_uuid();
  insert into public.products(id, tenant_id, sku, name, slug, price_b2c, stock, active, brand_id, manufacturer_code)
  values (v_product, v_tenant, 'AUTO-Q-'||v_suffix, 'Produto Fila Teste', 'produto-fila-'||v_suffix, 10, 1, true, v_brand, 'ABC-100');

  v_first := public.enqueue_product_enrichment_auto(v_tenant, 50);
  v_second := public.enqueue_product_enrichment_auto(v_tenant, 50);
  if v_first <> 1 then raise exception 'TEST_FAIL enqueue primeira chamada esperava 1, recebeu %', v_first; end if;
  if v_second <> 0 then raise exception 'TEST_FAIL enqueue idempotência esperava 0, recebeu %', v_second; end if;
  select count(*) into v_count from public.product_enrichment_jobs
   where tenant_id=v_tenant and product_id=v_product and status in ('queued','processing','review');
  if v_count <> 1 then raise exception 'TEST_FAIL job ativo duplicado: %', v_count; end if;
  update public.products set active=false where id=v_product and tenant_id=v_tenant;
  update public.product_enrichment_jobs set status='cancelled', finished_at=now()
   where tenant_id=v_tenant and product_id=v_product and status='queued';

  -- 2) GTIN divergente nunca é sobrescrito automaticamente.
  v_product := gen_random_uuid();
  insert into public.products(id, tenant_id, sku, name, slug, price_b2c, stock, active, brand_id, manufacturer_code, gtin, description)
  values (v_product, v_tenant, 'AUTO-G-'||v_suffix, 'Produto GTIN Teste', 'produto-gtin-'||v_suffix, 20, 1, true, v_brand, 'GT-200', '7894900011517', 'Descrição original');
  v_job := gen_random_uuid();
  insert into public.product_enrichment_jobs(id, tenant_id, product_id, trigger_source, status, search_query)
  values (v_job, v_tenant, v_product, 'auto', 'review', 'GT-200');
  v_candidate := gen_random_uuid();
  insert into public.product_enrichment_candidates(id, tenant_id, job_id, product_id, source_type, source_name, source_url,
    suggested_name, suggested_description, suggested_gtin, suggested_manufacturer_code, specifications, confidence, match_reasons, status)
  values (v_candidate, v_tenant, v_job, v_product, 'manufacturer', 'Fonte Oficial Teste', 'https://official-test.example.com/p/GT-200',
    'Produto GTIN Novo', 'Descrição que não deve ser aplicada', '7891910000197', 'GT-200',
    jsonb_build_object('source_domain','official-test.example.com','matched_code','GT-200'), 99, '["código exato"]'::jsonb, 'pending');
  v_result := public.auto_approve_product_enrichment_candidate(v_candidate, false);
  if coalesce((v_result->>'eligible')::boolean, false) then raise exception 'TEST_FAIL GTIN divergente foi considerado elegível'; end if;
  select gtin, description into v_gtin, v_desc from public.products where id=v_product and tenant_id=v_tenant;
  if v_gtin <> '7894900011517' or v_desc <> 'Descrição original' then raise exception 'TEST_FAIL produto com GTIN divergente foi alterado'; end if;
  update public.products set active=false where id=v_product and tenant_id=v_tenant;
  update public.product_enrichment_jobs set status='cancelled', finished_at=now() where id=v_job;

  -- 3) Imagem externa sem Storage próprio não é promovida.
  v_product := gen_random_uuid();
  insert into public.products(id, tenant_id, sku, name, slug, price_b2c, stock, active, brand_id, manufacturer_code)
  values (v_product, v_tenant, 'AUTO-I-'||v_suffix, 'Produto Imagem Teste', 'produto-imagem-'||v_suffix, 30, 1, true, v_brand, 'IMG-300');
  v_job := gen_random_uuid();
  insert into public.product_enrichment_jobs(id, tenant_id, product_id, trigger_source, status, search_query)
  values (v_job, v_tenant, v_product, 'auto', 'review', 'IMG-300');
  v_candidate := gen_random_uuid();
  insert into public.product_enrichment_candidates(id, tenant_id, job_id, product_id, source_type, source_name, source_url, image_url,
    suggested_name, suggested_manufacturer_code, specifications, confidence, match_reasons, status)
  values (v_candidate, v_tenant, v_job, v_product, 'manufacturer', 'Fonte Oficial Teste', 'https://official-test.example.com/p/IMG-300',
    'https://official-test.example.com/img/produto.jpg', 'Produto Imagem Novo', 'IMG-300',
    jsonb_build_object('source_domain','official-test.example.com','matched_code','IMG-300'), 99, '["imagem oficial"]'::jsonb, 'pending');
  insert into public.product_enrichment_candidate_images(tenant_id, candidate_id, product_id, source_url, selected, is_primary, sort_order)
  values (v_tenant, v_candidate, v_product, 'https://official-test.example.com/img/produto.jpg', true, true, 0);
  v_result := public.auto_approve_product_enrichment_candidate(v_candidate, false);
  if coalesce((v_result->>'eligible')::boolean, false) then raise exception 'TEST_FAIL imagem externa sem Storage foi promovida'; end if;
  select count(*) into v_count from public.product_images where tenant_id=v_tenant and product_id=v_product;
  if v_count <> 0 then raise exception 'TEST_FAIL produto recebeu imagem sem Storage próprio'; end if;
  update public.products set active=false where id=v_product and tenant_id=v_tenant;
  update public.product_enrichment_jobs set status='cancelled', finished_at=now() where id=v_job;

  -- 4) Produto sem marca/código não entra na fila automática.
  v_product := gen_random_uuid();
  insert into public.products(id, tenant_id, sku, name, slug, price_b2c, stock, active)
  values (v_product, v_tenant, 'AUTO-S-'||v_suffix, 'Produto Sem Marca', 'produto-sem-marca-'||v_suffix, 40, 1, true);
  v_first := public.enqueue_product_enrichment_auto(v_tenant, 50);
  if v_first <> 0 then raise exception 'TEST_FAIL produto sem marca/código alterou a fila: %', v_first; end if;
  select count(*) into v_count from public.product_enrichment_jobs
   where tenant_id=v_tenant and product_id=v_product and status in ('queued','processing','review');
  if v_count <> 0 then raise exception 'TEST_FAIL produto sem marca/código foi enfileirado'; end if;
  update public.products set active=false where id=v_product and tenant_id=v_tenant;

  -- 5) Fonte fora da whitelist permanece em revisão e não altera produto.
  v_product := gen_random_uuid();
  insert into public.products(id, tenant_id, sku, name, slug, price_b2c, stock, active, brand_id, manufacturer_code, description)
  values (v_product, v_tenant, 'AUTO-W-'||v_suffix, 'Produto Whitelist', 'produto-whitelist-'||v_suffix, 50, 1, true, v_brand, 'WL-500', 'Original');
  v_job := gen_random_uuid();
  insert into public.product_enrichment_jobs(id, tenant_id, product_id, trigger_source, status, search_query)
  values (v_job, v_tenant, v_product, 'auto', 'review', 'WL-500');
  v_candidate := gen_random_uuid();
  insert into public.product_enrichment_candidates(id, tenant_id, job_id, product_id, source_type, source_name, source_url,
    suggested_description, suggested_manufacturer_code, specifications, confidence, match_reasons, status)
  values (v_candidate, v_tenant, v_job, v_product, 'manufacturer', 'Fonte Não Permitida', 'https://nao-permitida.example.net/p/WL-500',
    'Não aplicar', 'WL-500', jsonb_build_object('source_domain','nao-permitida.example.net','matched_code','WL-500'), 99, '[]'::jsonb, 'pending');
  v_result := public.auto_approve_product_enrichment_candidate(v_candidate, false);
  if coalesce((v_result->>'eligible')::boolean, false) then raise exception 'TEST_FAIL fonte fora da whitelist foi autoaprovada'; end if;
  select description into v_desc from public.products where id=v_product and tenant_id=v_tenant;
  if v_desc <> 'Original' then raise exception 'TEST_FAIL fonte não permitida alterou produto'; end if;
  update public.products set active=false where id=v_product and tenant_id=v_tenant;
  update public.product_enrichment_jobs set status='cancelled', finished_at=now() where id=v_job;

  -- 6) Happy path.
  v_product := gen_random_uuid();
  insert into public.products(id, tenant_id, sku, name, slug, price_b2c, stock, active, brand_id, manufacturer_code)
  values (v_product, v_tenant, 'AUTO-H-'||v_suffix, 'Produto Happy', 'produto-happy-'||v_suffix, 60, 1, true, v_brand, 'HP-600');
  v_job := gen_random_uuid();
  insert into public.product_enrichment_jobs(id, tenant_id, product_id, trigger_source, status, search_query)
  values (v_job, v_tenant, v_product, 'auto', 'review', 'HP-600');
  v_candidate := gen_random_uuid();
  insert into public.product_enrichment_candidates(id, tenant_id, job_id, product_id, source_type, source_name, source_url,
    suggested_name, suggested_short_description, suggested_description, suggested_gtin, suggested_manufacturer_code,
    specifications, confidence, match_reasons, status)
  values (v_candidate, v_tenant, v_job, v_product, 'manufacturer', 'Fonte Oficial Teste', 'https://official-test.example.com/p/HP-600',
    'Produto Happy Enriquecido', 'Curta oficial', 'Descrição oficial completa', '7891910000197', 'HP-600',
    jsonb_build_object('source_domain','official-test.example.com','matched_code','HP-600'), 99, '["fonte oficial","código exato"]'::jsonb, 'pending');
  v_result := public.auto_approve_product_enrichment_candidate(v_candidate, false);
  if not coalesce((v_result->>'eligible')::boolean, false) then raise exception 'TEST_FAIL happy path não autoaprovou: %', v_result; end if;
  select gtin, description into v_gtin, v_desc from public.products where id=v_product and tenant_id=v_tenant;
  select status, approval_mode into v_status, v_mode from public.product_enrichment_jobs where id=v_job;
  select auto_approved into v_auto from public.product_enrichment_candidates where id=v_candidate;
  if v_gtin <> '7891910000197' or v_desc <> 'Descrição oficial completa' or v_status <> 'approved' or v_mode <> 'auto' or v_auto is not true then
    raise exception 'TEST_FAIL happy path estado final inválido';
  end if;
end $$;

rollback;
