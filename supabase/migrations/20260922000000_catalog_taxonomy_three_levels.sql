-- Taxonomia comercial v3: Departamento -> Grupo -> Subgrupo.
-- Não apaga nenhuma categoria trazida do Bling: as categorias legadas viram
-- subgrupos e cada produto mantém um caminho completo, auditável e reversível.

alter table public.products
  add column if not exists category_group_id uuid;

alter table public.products
  drop constraint if exists products_category_group_tenant_fkey;

alter table public.products
  add constraint products_category_group_tenant_fkey
  foreign key (category_group_id, tenant_id)
  references public.categories(id, tenant_id) on delete set null;

create index if not exists products_tenant_category_group_idx
  on public.products (tenant_id, category_group_id)
  where deleted_at is null;

-- Grupos são o nível intermediário. Os departamentos v2 existentes continuam
-- sendo a raiz; este insert é idempotente para todos os tenants.
with groups(department_slug, name, slug, sort_order) as (values
  ('som-automotivo','Áudio automotivo','som-audio',10),
  ('som-automotivo','Multimídia e integração','som-multimidia',20),
  ('som-automotivo','Instalação de som','som-instalacao',30),
  ('iluminacao','Faróis e lanternas','iluminacao-farois-lanternas',10),
  ('iluminacao','Lâmpadas e LED','iluminacao-led-lampadas',20),
  ('iluminacao','Acessórios de iluminação','iluminacao-acessorios',30),
  ('seguranca','Alarmes e bloqueadores','seguranca-alarmes',10),
  ('seguranca','Câmeras e sensores','seguranca-monitoramento',20),
  ('seguranca','Chaves e travas','seguranca-chaves-travas',30),
  ('acessorios-internos','Conforto interno','interior-conforto',10),
  ('acessorios-internos','Acabamento interno','interior-acabamento',20),
  ('carroceria-exterior','Para-choques e acabamentos','exterior-parachoques',10),
  ('carroceria-exterior','Acessórios externos','exterior-acessorios',20),
  ('vidros-portas-fechaduras','Vidros e máquinas','portas-vidros',10),
  ('vidros-portas-fechaduras','Portas e fechaduras','portas-fechaduras',20),
  ('eletrica-eletronica','Elétrica do veículo','eletrica-veiculo',10),
  ('eletrica-eletronica','Conectividade e instrumentos','eletrica-conectividade',20),
  ('engates-reboque','Engates','reboque-engates',10),
  ('engates-reboque','Acessórios para reboque','reboque-acessorios',20),
  ('limpeza-conservacao','Limpeza e conservação','limpeza-produtos',10),
  ('rodas-pneus','Rodas e calotas','rodas-calotas',10),
  ('motor-arrefecimento-protecao','Motor e arrefecimento','motor-arrefecimento',10),
  ('motor-arrefecimento-protecao','Proteção do motor','motor-protecao',20),
  ('suspensao-transmissao','Suspensão','suspensao-componentes',10),
  ('suspensao-transmissao','Transmissão','transmissao-componentes',20),
  ('fixacao-montagem','Fixação e montagem','fixacao-componentes',10),
  ('escapamento','Escapamento','escapamento-componentes',10),
  ('acessorios-externos','Outros acessórios','acessorios-outros',10)
)
insert into public.categories (tenant_id,name,slug,parent_id,sort_order,active)
select t.id,g.name,g.slug,d.id,g.sort_order,true
from public.tenants t
cross join groups g
join public.categories d on d.tenant_id=t.id and d.slug=g.department_slug and d.parent_id is null
on conflict (tenant_id,slug) do update set name=excluded.name,parent_id=excluded.parent_id,sort_order=excluded.sort_order,active=true;

-- As subcategorias v2 passam a pertencer ao grupo "principal" do respectivo
-- departamento. Isso cria três níveis sem alterar os nomes nem os links.
with roots as (
  select c.id,c.tenant_id,c.slug,c.parent_id from public.categories c
  where c.parent_id is null
), target as (
  select c.id, g.id as group_id
  from public.categories c
  join roots d on d.id=c.parent_id and d.tenant_id=c.tenant_id
  join public.categories g on g.tenant_id=c.tenant_id and g.parent_id=d.id
  where c.slug not like 'bling-%'
    -- Exclui os grupos recém-criados acima; eles não podem virar filhos de
    -- outro grupo na mesma migração.
    and c.created_at < now() - interval '1 minute'
    and g.slug = case d.slug
      when 'som-automotivo' then 'som-audio'
      when 'iluminacao' then 'iluminacao-farois-lanternas'
      when 'seguranca' then 'seguranca-alarmes'
      when 'acessorios-internos' then 'interior-conforto'
      when 'carroceria-exterior' then 'exterior-parachoques'
      when 'vidros-portas-fechaduras' then 'portas-vidros'
      when 'eletrica-eletronica' then 'eletrica-veiculo'
      when 'engates-reboque' then 'reboque-engates'
      when 'limpeza-conservacao' then 'limpeza-produtos'
      when 'rodas-pneus' then 'rodas-calotas'
      when 'motor-arrefecimento-protecao' then 'motor-arrefecimento'
      when 'suspensao-transmissao' then 'suspensao-componentes'
      when 'fixacao-montagem' then 'fixacao-componentes'
      when 'escapamento' then 'escapamento-componentes'
    end
)
update public.categories c set parent_id=target.group_id from target where c.id=target.id;

-- Categorias importadas do Bling são preservadas como folhas. A classificação
-- abaixo é deliberadamente conservadora; o restante fica em Outros acessórios,
-- nunca é excluído ou atribuído a uma peça incompatível.
with legacy as (
  select c.id,c.tenant_id,c.name,
    case
      when c.name ~* '(rádio|alto.falante|amplificador|rca|antena|multim[ií]dia|moldura)' then 'som-audio'
      when c.name ~* '(farol|lanterna|l[âa]mpada|led|x[eê]non|strob|lente)' then 'iluminacao-led-lampadas'
      when c.name ~* '(alarme|bloqueador|c[âa]mera|sensor|airbag|chave|trava)' then 'seguranca-alarmes'
      when c.name ~* '(tapete|bola de c[âa]mbio|coifa|difusor|quebra.sol|volante|apoio de bra[çc]o|aromatizante)' then 'interior-conforto'
      when c.name ~* '(para.choque|para.lama|para.barro|grade|friso|emblema|retrovisor|calha|forro de cap[oô]|aplique)' then 'exterior-parachoques'
      when c.name ~* '(vidro|ma[çc]aneta|fechadura|cabo de abertura|borracha|pingadeira)' then 'portas-fechaduras'
      when c.name ~* '(buzina|seta|chicote|fus[ií]vel|fio|volt[ií]metro|instrumento)' then 'eletrica-veiculo'
      when c.name ~* '(engate|reboque)' then 'reboque-engates'
      when c.name ~* '(limpeza|palheta|brucutu|esguicho)' then 'limpeza-produtos'
      when c.name ~* '(calota|roda)' then 'rodas-calotas'
      when c.name ~* '(eletroventilador|c[aá]rter)' then 'motor-protecao'
      when c.name ~* '(amortecedor|bandeja|bucha|homocin)' then 'suspensao-componentes'
      when c.name ~* '(presilha|grampo|parafuso|porca|abra[çc]adeira)' then 'fixacao-componentes'
      when c.name ~* 'escapamento' then 'escapamento-componentes'
      else 'acessorios-outros'
    end as group_slug
  from public.categories c where c.parent_id is null and c.slug like 'bling-%'
), moved as (
  update public.categories c set parent_id=g.id
  from legacy l join public.categories g on g.tenant_id=l.tenant_id and g.slug=l.group_slug
  where c.id=l.id returning c.id,c.tenant_id,c.parent_id as group_id
), assignment as (
  select m.id as leaf_id,m.tenant_id,m.group_id,g.parent_id as department_id
  from moved m join public.categories g on g.id=m.group_id and g.tenant_id=m.tenant_id
)
update public.products p
set category_id=a.department_id, category_group_id=a.group_id, subcategory_id=a.leaf_id, updated_at=now()
from assignment a
where p.tenant_id=a.tenant_id and p.category_id=a.leaf_id and p.deleted_at is null;

-- Produtos já associados à taxonomia v2 também recebem o grupo, sem alterar
-- departamento/subgrupo. A checagem abaixo impede caminhos incompletos novos.
update public.products p
set category_group_id=g.id, updated_at=now()
from public.categories leaf join public.categories g on g.id=leaf.parent_id and g.tenant_id=leaf.tenant_id
where p.tenant_id=leaf.tenant_id and p.subcategory_id=leaf.id and p.category_group_id is null and p.deleted_at is null;

create or replace function public.enforce_product_taxonomy_path()
returns trigger language plpgsql set search_path = '' as $$
declare v_group_parent uuid; v_leaf_parent uuid;
begin
  if new.category_group_id is null and new.subcategory_id is null then return new; end if;
  if new.category_id is null or new.category_group_id is null or new.subcategory_id is null then
    raise exception 'A taxonomia do produto deve conter departamento, grupo e subgrupo completos';
  end if;
  select parent_id into v_group_parent from public.categories where id=new.category_group_id and tenant_id=new.tenant_id;
  select parent_id into v_leaf_parent from public.categories where id=new.subcategory_id and tenant_id=new.tenant_id;
  if v_group_parent is distinct from new.category_id or v_leaf_parent is distinct from new.category_group_id then
    raise exception 'Caminho de taxonomia inválido';
  end if;
  return new;
end; $$;

drop trigger if exists products_enforce_taxonomy_path on public.products;
create trigger products_enforce_taxonomy_path before insert or update of category_id,category_group_id,subcategory_id
on public.products for each row execute function public.enforce_product_taxonomy_path();

comment on column public.products.category_group_id is 'Nível intermediário da taxonomia comercial: Departamento -> Grupo -> Subgrupo.';
