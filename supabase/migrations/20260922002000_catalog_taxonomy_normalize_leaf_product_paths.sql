-- Normaliza produtos que apontavam diretamente para uma folha já organizada.
-- A categoria atual vira o subgrupo; seus dois ancestrais completam o caminho.
update public.products p
set category_id=department.id,
    category_group_id=grp.id,
    subcategory_id=leaf.id,
    updated_at=now()
from public.categories leaf
join public.categories grp on grp.id=leaf.parent_id and grp.tenant_id=leaf.tenant_id
join public.categories department on department.id=grp.parent_id and department.tenant_id=grp.tenant_id
where p.tenant_id=leaf.tenant_id
  and p.category_id=leaf.id
  and p.category_group_id is null
  and p.subcategory_id is null
  and p.deleted_at is null;
