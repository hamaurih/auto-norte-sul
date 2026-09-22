-- Completa caminhos de produtos que já possuíam somente o departamento.
-- Não tenta adivinhar o tipo da peça: usa explicitamente "Outros itens" dentro
-- do próprio departamento, preservando a classificação existente.
with departments as (
  select distinct c.tenant_id,c.id,c.slug,c.name
  from public.categories c
  join public.products p on p.tenant_id=c.tenant_id and p.category_id=c.id
  where c.parent_id is null and p.deleted_at is null and p.category_group_id is null
), groups as (
  insert into public.categories (tenant_id,name,slug,parent_id,sort_order,active)
  select tenant_id,'Outros itens de ' || name,'outros-' || slug,id,999,true from departments
  on conflict (tenant_id,slug) do update set parent_id=excluded.parent_id,active=true
  returning tenant_id,id,parent_id,slug
), leaves as (
  insert into public.categories (tenant_id,name,slug,parent_id,sort_order,active)
  select tenant_id,'Produtos diversos','diversos-' || slug,id,999,true from groups
  on conflict (tenant_id,slug) do update set parent_id=excluded.parent_id,active=true
  returning tenant_id,id,parent_id
)
update public.products p
set category_group_id=g.id,subcategory_id=l.id,updated_at=now()
from groups g join leaves l on l.tenant_id=g.tenant_id and l.parent_id=g.id
where p.tenant_id=g.tenant_id and p.category_id=g.parent_id and p.category_group_id is null and p.subcategory_id is null and p.deleted_at is null;
