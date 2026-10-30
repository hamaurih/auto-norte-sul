begin;

with unique_matches as (
  select
    q.id as quote_id,
    q.tenant_id,
    min(c.id::text)::uuid as customer_id
  from public.quotes q
  join public.customers c
    on c.tenant_id=q.tenant_id
   and c.active
   and c.user_id is not null
   and lower(trim(c.name))=lower(trim(q.customer_name))
  where q.deleted_at is null
    and q.customer_id is null
    and q.customer_name is not null
    and btrim(q.customer_name)<>''
  group by q.id,q.tenant_id
  having count(c.id)=1
)
update public.quotes q
set customer_id=m.customer_id,
    customer_email=coalesce(nullif(q.customer_email,''),c.email),
    customer_phone=coalesce(nullif(q.customer_phone,''),c.phone),
    updated_at=now()
from unique_matches m
join public.customers c
  on c.id=m.customer_id and c.tenant_id=m.tenant_id
where q.id=m.quote_id
  and q.tenant_id=m.tenant_id
  and q.customer_id is null;

commit;