-- Taxonomia v2 do catálogo Norte Sul.
-- Separa categoria, subcategoria e fabricante; usa somente o tipo do produto
-- reconhecido no início do nome para aplicações automáticas de alta confiança.

-- 1. Categorias principais estáveis. Slugs antigos em uso são preservados para
-- não quebrar links do catálogo.
insert into public.categories (tenant_id, name, slug, sort_order, active)
select t.id, v.name, v.slug, v.sort_order, true
from public.tenants t
cross join (values
  ('Som e Multimídia', 'som-automotivo', 10),
  ('Iluminação Automotiva', 'iluminacao', 20),
  ('Segurança e Controle', 'seguranca', 30),
  ('Interior e Conforto', 'acessorios-internos', 40),
  ('Carroceria e Acabamento Externo', 'carroceria-exterior', 50),
  ('Vidros, Portas e Fechaduras', 'vidros-portas-fechaduras', 60),
  ('Elétrica e Eletrônica', 'eletrica-eletronica', 70),
  ('Engates e Reboque', 'engates-reboque', 80),
  ('Limpeza e Conservação', 'limpeza-conservacao', 90),
  ('Rodas e Calotas', 'rodas-pneus', 100),
  ('Motor, Arrefecimento e Proteção', 'motor-arrefecimento-protecao', 110),
  ('Suspensão e Transmissão', 'suspensao-transmissao', 120),
  ('Fixação e Montagem', 'fixacao-montagem', 130),
  ('Escapamento', 'escapamento', 140),
  ('Acessórios Externos', 'acessorios-externos', 900)
) as v(name, slug, sort_order)
on conflict (tenant_id, slug) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    active = true;

-- Categorias antigas vazias deixam de aparecer na loja, sem exclusão física.
update public.categories c
set active = false
where c.slug in ('estetica', 'performance')
  and not exists (
    select 1 from public.products p
    where p.tenant_id = c.tenant_id
      and (p.category_id = c.id or p.subcategory_id = c.id)
  );

-- 2. Subcategorias. O parent_id é sempre resolvido pelo tenant + slug.
with taxonomy(parent_slug, name, slug, sort_order) as (values
  ('som-automotivo', 'Auto-rádios', 'auto-radios', 10),
  ('som-automotivo', 'Centrais Multimídia', 'multimidia', 20),
  ('som-automotivo', 'Alto-falantes', 'alto-falantes', 30),
  ('som-automotivo', 'Kits de Som Automotivo', 'kits-som-automotivo', 40),
  ('som-automotivo', 'Cabos e Conectores RCA', 'cabos-conectores-rca', 50),
  ('som-automotivo', 'Antenas', 'antenas', 60),
  ('som-automotivo', 'Molduras e Painéis', 'moldura', 70),

  ('iluminacao', 'Faróis', 'farois', 10),
  ('iluminacao', 'Kit Farol de Milha', 'kit-farol-milha', 20),
  ('iluminacao', 'Lanternas', 'lanternas', 30),
  ('iluminacao', 'Lentes', 'lentes-iluminacao', 40),
  ('iluminacao', 'Lâmpadas', 'lampadas', 50),
  ('iluminacao', 'LED e Ultra LED', 'led-ultra-led', 60),
  ('iluminacao', 'Refletores', 'refletores', 70),

  ('seguranca', 'Alarmes e Bloqueadores', 'alarmes-bloqueadores', 10),
  ('seguranca', 'Câmeras', 'cameras', 20),
  ('seguranca', 'Sensores de Estacionamento', 'sensores-estacionamento', 30),
  ('seguranca', 'Cintas de Airbag', 'cintas-airbag', 40),
  ('seguranca', 'Chaves e Controles', 'chaves-controles', 50),
  ('seguranca', 'Travas Antifurto', 'travas-antifurto', 60),

  ('acessorios-internos', 'Tapetes', 'tapetes', 10),
  ('acessorios-internos', 'Manoplas e Bolas de Câmbio', 'manoplas-bolas-cambio', 20),
  ('acessorios-internos', 'Coifas', 'coifas', 30),
  ('acessorios-internos', 'Difusores de Ar', 'difusores-ar', 40),
  ('acessorios-internos', 'Quebra-sóis', 'quebra-sois', 50),
  ('acessorios-internos', 'Capas Internas', 'capas-internas', 60),
  ('acessorios-internos', 'Apoios de Braço', 'apoios-braco', 70),
  ('acessorios-internos', 'Aromatizantes', 'aromatizantes', 80),

  ('carroceria-exterior', 'Para-choques', 'para-choques', 10),
  ('carroceria-exterior', 'Guias e Suportes de Para-choque', 'guias-suportes-parachoque', 20),
  ('carroceria-exterior', 'Para-barros', 'para-barros', 30),
  ('carroceria-exterior', 'Para-lamas', 'para-lamas', 40),
  ('carroceria-exterior', 'Grades', 'grades', 50),
  ('carroceria-exterior', 'Amortecedores de Capô e Porta-malas', 'amortecedores-capo-porta-malas', 60),
  ('carroceria-exterior', 'Frisos e Acabamentos', 'frisos-acabamentos', 70),
  ('carroceria-exterior', 'Emblemas e Logotipos', 'emblemas-logotipos', 80),
  ('carroceria-exterior', 'Retrovisores', 'retrovisores', 90),
  ('carroceria-exterior', 'Calhas de Chuva', 'calhas-chuva', 110),
  ('carroceria-exterior', 'Tampas e Ganchos de Reboque', 'tampas-ganchos-reboque', 120),
  ('carroceria-exterior', 'Forros de Capô', 'forros-capo', 130),
  ('carroceria-exterior', 'Apliques', 'apliques', 140),

  ('vidros-portas-fechaduras', 'Reparos para Máquinas de Vidro', 'reparos-maquina-vidro', 10),
  ('vidros-portas-fechaduras', 'Máquinas de Vidro', 'maquinas-vidro', 20),
  ('vidros-portas-fechaduras', 'Maçanetas', 'macanetas', 30),
  ('vidros-portas-fechaduras', 'Fechaduras', 'fechaduras', 40),
  ('vidros-portas-fechaduras', 'Interruptores de Vidro', 'interruptores-vidro', 50),
  ('vidros-portas-fechaduras', 'Cabos de Abertura', 'cabos-abertura', 60),
  ('vidros-portas-fechaduras', 'Motores de Vidro Elétrico', 'motores-vidro-eletrico', 70),
  ('vidros-portas-fechaduras', 'Módulos de Vidro', 'modulos-vidro', 80),
  ('vidros-portas-fechaduras', 'Borrachas e Pingadeiras', 'borrachas-pingadeiras', 90),

  ('eletrica-eletronica', 'Buzinas', 'buzinas', 10),
  ('eletrica-eletronica', 'Chaves de Seta', 'chaves-seta', 20),
  ('eletrica-eletronica', 'Chicotes', 'chicotes', 30),
  ('eletrica-eletronica', 'Fusíveis', 'fusiveis', 40),
  ('eletrica-eletronica', 'Terminais e Conectores', 'terminais-conectores', 50),
  ('eletrica-eletronica', 'Tomadas e Alimentação 12V', 'tomadas-alimentacao-12v', 60),

  ('engates-reboque', 'Engates', 'engates', 10),
  ('engates-reboque', 'Engates Fixos', 'engates-fixos', 20),
  ('engates-reboque', 'Engates Removíveis', 'engates-removiveis', 30),
  ('engates-reboque', 'Acessórios para Engate', 'acessorios-engate', 40),

  ('limpeza-conservacao', 'Esguichos e Brucutus', 'esguichos-brucutus', 10),
  ('limpeza-conservacao', 'Palhetas', 'palhetas', 20),
  ('limpeza-conservacao', 'Produtos de Limpeza', 'produtos-limpeza', 30),

  ('rodas-pneus', 'Calotas', 'calotas', 10),

  ('motor-arrefecimento-protecao', 'Eletroventiladores', 'eletroventiladores', 10),
  ('motor-arrefecimento-protecao', 'Protetores de Cárter', 'protetores-carter', 20),

  ('suspensao-transmissao', 'Juntas Homocinéticas', 'juntas-homocineticas', 10),
  ('suspensao-transmissao', 'Bandejas', 'bandejas', 20),
  ('suspensao-transmissao', 'Buchas e Batentes', 'buchas-batentes', 30),

  ('fixacao-montagem', 'Presilhas e Grampos', 'presilhas-grampos', 10),
  ('fixacao-montagem', 'Parafusos e Porcas', 'parafusos-porcas', 20),
  ('fixacao-montagem', 'Abraçadeiras', 'abracadeiras', 30),

  ('escapamento', 'Ponteiras de Escapamento', 'ponteiras-escapamento', 10)
)
insert into public.categories (tenant_id, name, slug, parent_id, sort_order, active)
select t.id, x.name, x.slug, parent.id, x.sort_order, true
from public.tenants t
cross join taxonomy x
join public.categories parent
  on parent.tenant_id = t.id
 and parent.slug = x.parent_slug
on conflict (tenant_id, slug) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    active = true;

-- 3. Regras versionadas e auditáveis.
create table if not exists public.catalog_taxonomy_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_key text not null,
  match_label text not null,
  category_slug text not null,
  subcategory_slug text not null,
  pattern text not null,
  priority integer not null check (priority between 1 and 10000),
  confidence text not null default 'alta' check (confidence in ('alta', 'media', 'baixa')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, rule_key),
  unique (id, tenant_id),
  foreign key (tenant_id, category_slug) references public.categories(tenant_id, slug) on delete restrict,
  foreign key (tenant_id, subcategory_slug) references public.categories(tenant_id, slug) on delete restrict
);

create index if not exists catalog_taxonomy_rules_tenant_active_priority_idx
  on public.catalog_taxonomy_rules (tenant_id, active, priority);
create index if not exists catalog_taxonomy_rules_category_idx
  on public.catalog_taxonomy_rules (tenant_id, category_slug);
create index if not exists catalog_taxonomy_rules_subcategory_idx
  on public.catalog_taxonomy_rules (tenant_id, subcategory_slug);

alter table public.catalog_taxonomy_rules enable row level security;

drop policy if exists catalog_taxonomy_rules_select_staff on public.catalog_taxonomy_rules;
create policy catalog_taxonomy_rules_select_staff
on public.catalog_taxonomy_rules for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','stock'])));

drop policy if exists catalog_taxonomy_rules_write_manager on public.catalog_taxonomy_rules;
drop policy if exists catalog_taxonomy_rules_insert_manager on public.catalog_taxonomy_rules;
create policy catalog_taxonomy_rules_insert_manager
on public.catalog_taxonomy_rules for insert to authenticated
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])));

drop policy if exists catalog_taxonomy_rules_update_manager on public.catalog_taxonomy_rules;
create policy catalog_taxonomy_rules_update_manager
on public.catalog_taxonomy_rules for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])))
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])));

drop policy if exists catalog_taxonomy_rules_delete_manager on public.catalog_taxonomy_rules;
create policy catalog_taxonomy_rules_delete_manager
on public.catalog_taxonomy_rules for delete to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])));

revoke all on public.catalog_taxonomy_rules from anon;
grant select, insert, update, delete on public.catalog_taxonomy_rules to authenticated;

with rules(rule_key, match_label, category_slug, subcategory_slug, pattern, priority) as (values
  ('fixacao_presilhas', 'presilha/grampo', 'fixacao-montagem', 'presilhas-grampos', '^(presilha|grampo)', 10),
  ('fixacao_parafusos', 'parafuso/porca', 'fixacao-montagem', 'parafusos-porcas', '^(parafuso|porca)', 11),
  ('fixacao_abracadeiras', 'abraçadeira', 'fixacao-montagem', 'abracadeiras', '^abracadeira', 12),

  ('vidro_reparo', 'kit reparo máquina de vidro', 'vidros-portas-fechaduras', 'reparos-maquina-vidro', '^kit reparo.*maquina de vidro', 20),
  ('vidro_motor', 'motor de vidro elétrico', 'vidros-portas-fechaduras', 'motores-vidro-eletrico', '^motor (de|para maquina de) vidro', 21),
  ('vidro_modulo', 'módulo de vidro', 'vidros-portas-fechaduras', 'modulos-vidro', '^modulo (de )?vidro', 22),
  ('vidro_maquina', 'máquina de vidro', 'vidros-portas-fechaduras', 'maquinas-vidro', '^maquina de vidro', 23),
  ('porta_macaneta', 'maçaneta', 'vidros-portas-fechaduras', 'macanetas', '^macaneta', 24),
  ('porta_fechadura', 'fechadura', 'vidros-portas-fechaduras', 'fechaduras', '^fechadura', 25),
  ('vidro_interruptor', 'interruptor de vidro', 'vidros-portas-fechaduras', 'interruptores-vidro', '^interruptor.*vidro', 26),
  ('porta_cabo_abertura', 'cabo de abertura', 'vidros-portas-fechaduras', 'cabos-abertura', '^cabo (de )?(abertura|acionador|limitador)', 27),

  ('limpeza_esguicho', 'esguicho/brucutu', 'limpeza-conservacao', 'esguichos-brucutus', '^(kit esguicho|esguicho|brucutu)', 30),
  ('limpeza_palheta', 'palheta', 'limpeza-conservacao', 'palhetas', '^(palheta|limpa para-brisa)', 31),
  ('limpeza_produto', 'produto de limpeza', 'limpeza-conservacao', 'produtos-limpeza', '^(shampoo|cera|polidor|revitalizador|limpa auto|desengripante)', 32),

  ('iluminacao_kit_milha', 'kit farol', 'iluminacao', 'kit-farol-milha', '^kit farol', 40),
  ('iluminacao_farol', 'farol', 'iluminacao', 'farois', '^farol', 41),
  ('iluminacao_lanterna', 'lanterna', 'iluminacao', 'lanternas', '^(lanterna|laterna)', 42),
  ('iluminacao_lente', 'lente', 'iluminacao', 'lentes-iluminacao', '^lente', 43),
  ('iluminacao_lampada', 'lâmpada', 'iluminacao', 'lampadas', '^lampada', 44),
  ('iluminacao_led', 'LED/Ultra LED', 'iluminacao', 'led-ultra-led', '^(led|super led|ultra led|ultraled|kit led|kit ultra led|pingo de led)', 45),
  ('iluminacao_refletor', 'refletor', 'iluminacao', 'refletores', '^refletor', 46),

  ('rodas_calotas', 'calota', 'rodas-pneus', 'calotas', '^calota', 50),

  ('engate_fixo', 'engate fixo', 'engates-reboque', 'engates-fixos', '^engate fixo', 60),
  ('engate_removivel', 'engate removível', 'engates-reboque', 'engates-removiveis', '^engate (rem\\.|removivel)', 61),
  ('engate_principal', 'engate', 'engates-reboque', 'engates', '^engate', 62),
  ('engate_acessorios', 'acessório para engate', 'engates-reboque', 'acessorios-engate', '^(capa bola de engate|bola de engate|acessorio.*engate)', 63),

  ('som_central', 'central multimídia', 'som-automotivo', 'multimidia', '^(central multimidia|multimidia)', 70),
  ('som_radio', 'auto-rádio', 'som-automotivo', 'auto-radios', '^auto radio', 71),
  ('som_alto_falante', 'alto-falante', 'som-automotivo', 'alto-falantes', '^(alto-falante|par de alto-falante|kit alto-falante|subwoofer|tweeter|driver|corneta)', 72),
  ('som_kits', 'kit de som', 'som-automotivo', 'kits-som-automotivo', '^es kit auto radio', 73),
  ('som_rca', 'cabo/conector RCA', 'som-automotivo', 'cabos-conectores-rca', '^(cabo rca|plug rca)', 74),
  ('som_antena', 'antena', 'som-automotivo', 'antenas', '^antena', 75),
  ('som_moldura', 'moldura', 'som-automotivo', 'moldura', '^moldura', 76),

  ('seguranca_alarme', 'alarme', 'seguranca', 'alarmes-bloqueadores', '^alarme', 80),
  ('seguranca_camera', 'câmera', 'seguranca', 'cameras', '^camera', 81),
  ('seguranca_sensor', 'sensor de ré/estacionamento', 'seguranca', 'sensores-estacionamento', '^sensor (de )?(re|estacionamento)', 82),
  ('seguranca_airbag', 'cinta de airbag', 'seguranca', 'cintas-airbag', '^cinta de airbag', 83),
  ('seguranca_chaves', 'chave/controle', 'seguranca', 'chaves-controles', '^(chave canivete|controle|carcaca.*chave)', 84),
  ('seguranca_trava', 'trava antifurto', 'seguranca', 'travas-antifurto', '^trava (antifurto|de seguranca)', 85),

  ('interior_tapete', 'tapete', 'acessorios-internos', 'tapetes', '^tapete', 90),
  ('interior_manopla', 'manopla/bola de câmbio', 'acessorios-internos', 'manoplas-bolas-cambio', '^(bola de cambio|manopla|b.cambio)', 91),
  ('interior_coifa', 'coifa', 'acessorios-internos', 'coifas', '^coifa', 92),
  ('interior_difusor', 'difusor de ar', 'acessorios-internos', 'difusores-ar', '^difusor', 93),
  ('interior_quebra_sol', 'quebra-sol', 'acessorios-internos', 'quebra-sois', '^quebra[ -]sol', 94),
  ('interior_capas', 'capa interna', 'acessorios-internos', 'capas-internas', '^capa (de )?(volante|pedal|banco)', 95),
  ('interior_apoio_braco', 'apoio de braço', 'acessorios-internos', 'apoios-braco', '^apoio de braco', 96),
  ('interior_aromatizante', 'aromatizante', 'acessorios-internos', 'aromatizantes', '^aromatizante', 97),

  ('carroceria_parachoque', 'para-choque', 'carroceria-exterior', 'para-choques', '^(para-choque|parachoque)', 100),
  ('carroceria_guia', 'guia/suporte de para-choque', 'carroceria-exterior', 'guias-suportes-parachoque', '^(guia (de )?para-choque|guia parachoque|suporte guia)', 101),
  ('carroceria_parabarro', 'para-barro', 'carroceria-exterior', 'para-barros', '^para-barro', 102),
  ('carroceria_paralama', 'para-lama', 'carroceria-exterior', 'para-lamas', '^para-lama', 103),
  ('carroceria_grade', 'grade', 'carroceria-exterior', 'grades', '^grade', 104),
  ('carroceria_amortecedor', 'amortecedor de capô/porta-malas', 'carroceria-exterior', 'amortecedores-capo-porta-malas', '^amortecedor de (capo|porta|mala)', 105),
  ('carroceria_friso', 'friso/acabamento', 'carroceria-exterior', 'frisos-acabamentos', '^(friso|acabamento)', 106),
  ('carroceria_emblema', 'emblema/logotipo', 'carroceria-exterior', 'emblemas-logotipos', '^(emblema|logo)', 107),
  ('carroceria_retrovisor', 'retrovisor', 'carroceria-exterior', 'retrovisores', '^retrovisor', 108),
  ('porta_borracha', 'borracha/pingadeira de porta', 'vidros-portas-fechaduras', 'borrachas-pingadeiras', '^(borracha|pingadeira)', 109),
  ('carroceria_calha', 'calha de chuva', 'carroceria-exterior', 'calhas-chuva', '^calha de', 110),
  ('carroceria_reboque', 'tampa/gancho de reboque', 'carroceria-exterior', 'tampas-ganchos-reboque', '^(tampa reboque|gancho.*reboque)', 111),
  ('carroceria_forro_capo', 'forro de capô', 'carroceria-exterior', 'forros-capo', '^forro (de )?capo', 112),
  ('carroceria_aplique', 'aplique', 'carroceria-exterior', 'apliques', '^aplique', 113),

  ('suspensao_junta', 'junta homocinética', 'suspensao-transmissao', 'juntas-homocineticas', '^junta homocinetica', 120),
  ('suspensao_bandeja', 'bandeja', 'suspensao-transmissao', 'bandejas', '^bandeja', 121),
  ('suspensao_bucha', 'bucha/batente', 'suspensao-transmissao', 'buchas-batentes', '^(bucha|batente)', 122),

  ('eletrica_buzina', 'buzina', 'eletrica-eletronica', 'buzinas', '^buzina', 130),
  ('eletrica_chave_seta', 'chave de seta', 'eletrica-eletronica', 'chaves-seta', '^chave de seta', 131),
  ('eletrica_chicote', 'chicote', 'eletrica-eletronica', 'chicotes', '^chicote', 132),
  ('eletrica_fusivel', 'fusível', 'eletrica-eletronica', 'fusiveis', '^fusivel', 133),
  ('eletrica_terminal', 'terminal/conector', 'eletrica-eletronica', 'terminais-conectores', '^(terminal|soquete)', 134),
  ('eletrica_12v', 'tomada/alimentação 12V', 'eletrica-eletronica', 'tomadas-alimentacao-12v', '^(tomada|12v|bateria)', 135),

  ('motor_eletroventilador', 'eletroventilador', 'motor-arrefecimento-protecao', 'eletroventiladores', '^eletroventilador', 140),
  ('motor_protetor_carter', 'protetor de cárter', 'motor-arrefecimento-protecao', 'protetores-carter', '^(kit (f )?protetor|protetor de carter)', 141),

  ('escapamento_ponteira', 'ponteira de escapamento', 'escapamento', 'ponteiras-escapamento', '^ponteira', 150)
)
insert into public.catalog_taxonomy_rules (
  tenant_id, rule_key, match_label, category_slug, subcategory_slug, pattern, priority, confidence, active
)
select t.id, r.rule_key, r.match_label, r.category_slug, r.subcategory_slug, r.pattern, r.priority, 'alta', true
from public.tenants t
cross join rules r
on conflict (tenant_id, rule_key) do update
set match_label = excluded.match_label,
    category_slug = excluded.category_slug,
    subcategory_slug = excluded.subcategory_slug,
    pattern = excluded.pattern,
    priority = excluded.priority,
    confidence = excluded.confidence,
    active = true,
    updated_at = now();

-- 4. Histórico imutável de toda movimentação.
create table if not exists public.product_taxonomy_assignment_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  previous_category_id uuid,
  previous_subcategory_id uuid,
  assigned_category_id uuid not null,
  assigned_subcategory_id uuid not null,
  rule_id uuid,
  confidence text not null check (confidence in ('alta', 'media', 'baixa')),
  source text not null check (source in ('migration_v2', 'manual_suggestion', 'manual_override', 'bulk_review')),
  batch_key text not null,
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz not null default now(),
  unique (tenant_id, product_id, batch_key),
  foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade,
  foreign key (previous_category_id, tenant_id) references public.categories(id, tenant_id) on delete restrict,
  foreign key (previous_subcategory_id, tenant_id) references public.categories(id, tenant_id) on delete restrict,
  foreign key (assigned_category_id, tenant_id) references public.categories(id, tenant_id) on delete restrict,
  foreign key (assigned_subcategory_id, tenant_id) references public.categories(id, tenant_id) on delete restrict,
  foreign key (rule_id, tenant_id) references public.catalog_taxonomy_rules(id, tenant_id) on delete restrict
);

create index if not exists product_taxonomy_audit_product_idx
  on public.product_taxonomy_assignment_audit (tenant_id, product_id, applied_at desc);
create index if not exists product_taxonomy_audit_product_fk_idx
  on public.product_taxonomy_assignment_audit (product_id, tenant_id);
create index if not exists product_taxonomy_audit_rule_idx
  on public.product_taxonomy_assignment_audit (rule_id, tenant_id) where rule_id is not null;
create index if not exists product_taxonomy_audit_applied_by_idx
  on public.product_taxonomy_assignment_audit (applied_by) where applied_by is not null;
create index if not exists product_taxonomy_audit_previous_category_idx
  on public.product_taxonomy_assignment_audit (previous_category_id, tenant_id)
  where previous_category_id is not null;
create index if not exists product_taxonomy_audit_previous_subcategory_idx
  on public.product_taxonomy_assignment_audit (previous_subcategory_id, tenant_id)
  where previous_subcategory_id is not null;
create index if not exists product_taxonomy_audit_assigned_category_idx
  on public.product_taxonomy_assignment_audit (assigned_category_id, tenant_id);
create index if not exists product_taxonomy_audit_assigned_subcategory_idx
  on public.product_taxonomy_assignment_audit (assigned_subcategory_id, tenant_id);

alter table public.product_taxonomy_assignment_audit enable row level security;

drop policy if exists product_taxonomy_audit_select_staff on public.product_taxonomy_assignment_audit;
create policy product_taxonomy_audit_select_staff
on public.product_taxonomy_assignment_audit for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner','admin','manager','stock'])));

drop policy if exists product_taxonomy_audit_insert_manager on public.product_taxonomy_assignment_audit;
create policy product_taxonomy_audit_insert_manager
on public.product_taxonomy_assignment_audit for insert to authenticated
with check ((select private.has_tenant_role(tenant_id, array['owner','admin','manager'])));

revoke all on public.product_taxonomy_assignment_audit from anon;
grant select, insert on public.product_taxonomy_assignment_audit to authenticated;

-- 5. Aplicação transacional validada no servidor. SECURITY INVOKER mantém RLS.
create or replace function public.apply_catalog_taxonomy_assignments(
  p_assignments jsonb,
  p_source text default 'manual_suggestion'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_key text := gen_random_uuid()::text;
  v_applied integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be a JSON array';
  end if;
  if jsonb_array_length(p_assignments) > 2000 then
    raise exception 'Maximum of 2000 assignments per call';
  end if;
  if p_source not in ('manual_suggestion', 'manual_override', 'bulk_review') then
    raise exception 'Invalid taxonomy assignment source';
  end if;

  with input as (
    select *
    from jsonb_to_recordset(p_assignments) as x(
      product_id uuid,
      category_id uuid,
      subcategory_id uuid,
      rule_id uuid,
      confidence text
    )
  ), valid as (
    select
      p.tenant_id,
      p.id as product_id,
      p.category_id as previous_category_id,
      p.subcategory_id as previous_subcategory_id,
      c.id as assigned_category_id,
      sc.id as assigned_subcategory_id,
      r.id as rule_id,
      case when i.confidence in ('alta','media','baixa') then i.confidence else 'baixa' end as confidence
    from input i
    join public.products p on p.id = i.product_id and p.deleted_at is null
    join public.categories c
      on c.id = i.category_id and c.tenant_id = p.tenant_id and c.parent_id is null and c.active
    join public.categories sc
      on sc.id = i.subcategory_id and sc.tenant_id = p.tenant_id and sc.parent_id = c.id and sc.active
    left join public.catalog_taxonomy_rules r
      on r.id = i.rule_id and r.tenant_id = p.tenant_id and r.active
    where (select private.has_tenant_role(p.tenant_id, array['owner','admin','manager']))
      and (
        i.rule_id is null
        or (r.category_slug = c.slug and r.subcategory_slug = sc.slug)
      )
  ), audited as (
    insert into public.product_taxonomy_assignment_audit (
      tenant_id, product_id, previous_category_id, previous_subcategory_id,
      assigned_category_id, assigned_subcategory_id, rule_id, confidence,
      source, batch_key, applied_by
    )
    select
      tenant_id, product_id, previous_category_id, previous_subcategory_id,
      assigned_category_id, assigned_subcategory_id, rule_id, confidence,
      p_source, v_batch_key, (select auth.uid())
    from valid
    returning tenant_id, product_id, assigned_category_id, assigned_subcategory_id
  ), updated as (
    update public.products p
    set category_id = a.assigned_category_id,
        subcategory_id = a.assigned_subcategory_id,
        updated_at = now()
    from audited a
    where p.id = a.product_id and p.tenant_id = a.tenant_id
    returning p.id
  )
  select count(*) into v_applied from updated;

  return jsonb_build_object('applied', v_applied, 'batchKey', v_batch_key);
end;
$$;

revoke all on function public.apply_catalog_taxonomy_assignments(jsonb, text) from public, anon;
grant execute on function public.apply_catalog_taxonomy_assignments(jsonb, text) to authenticated;

-- 6. Migração inicial: apenas regras únicas e de alta confiança. Itens sem regra
-- ou com colisão permanecem intocados para revisão humana.
with normalized as (
  select
    p.id,
    p.tenant_id,
    p.category_id,
    p.subcategory_id,
    trim(lower(translate(
      p.name,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
    ))) as normalized_name
  from public.products p
  where p.deleted_at is null
), raw_matches as (
  select
    n.*,
    r.id as rule_id,
    r.category_slug,
    r.subcategory_slug,
    r.confidence,
    r.priority,
    min(r.priority) over (partition by n.tenant_id, n.id) as best_priority
  from normalized n
  join public.catalog_taxonomy_rules r
    on r.tenant_id = n.tenant_id
   and r.active
   and n.normalized_name ~ r.pattern
), matched as (
  select
    rm.*,
    row_number() over (partition by rm.tenant_id, rm.id order by rm.priority, rm.rule_id) as match_rank,
    count(*) filter (where rm.priority = rm.best_priority)
      over (partition by rm.tenant_id, rm.id) as best_match_count
  from raw_matches rm
), candidates as (
  select
    m.tenant_id,
    m.id as product_id,
    m.category_id as previous_category_id,
    m.subcategory_id as previous_subcategory_id,
    c.id as assigned_category_id,
    sc.id as assigned_subcategory_id,
    m.rule_id,
    m.confidence
  from matched m
  join public.categories c
    on c.tenant_id = m.tenant_id and c.slug = m.category_slug and c.parent_id is null and c.active
  join public.categories sc
    on sc.tenant_id = m.tenant_id and sc.slug = m.subcategory_slug and sc.parent_id = c.id and sc.active
  where m.match_rank = 1
    and m.best_match_count = 1
    and m.confidence = 'alta'
    and (m.category_id is distinct from c.id or m.subcategory_id is distinct from sc.id)
), audited as (
  insert into public.product_taxonomy_assignment_audit (
    tenant_id, product_id, previous_category_id, previous_subcategory_id,
    assigned_category_id, assigned_subcategory_id, rule_id, confidence,
    source, batch_key, applied_by
  )
  select
    tenant_id, product_id, previous_category_id, previous_subcategory_id,
    assigned_category_id, assigned_subcategory_id, rule_id, confidence,
    'migration_v2', 'taxonomy_v2_initial_20260901', null
  from candidates
  on conflict (tenant_id, product_id, batch_key) do nothing
  returning tenant_id, product_id, assigned_category_id, assigned_subcategory_id
)
update public.products p
set category_id = a.assigned_category_id,
    subcategory_id = a.assigned_subcategory_id,
    updated_at = now()
from audited a
where p.id = a.product_id and p.tenant_id = a.tenant_id;
