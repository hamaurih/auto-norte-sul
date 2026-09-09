-- Search aliases are tenant-owned. A global unique key would let one tenant
-- collide with another tenant's alias even though RLS correctly isolates rows.
ALTER TABLE public.search_aliases
  DROP CONSTRAINT IF EXISTS search_aliases_normalized_term_target_type_target_slug_key;

ALTER TABLE public.search_aliases
  ADD CONSTRAINT search_aliases_tenant_normalized_target_key
  UNIQUE (tenant_id, normalized_term, target_type, target_slug);
