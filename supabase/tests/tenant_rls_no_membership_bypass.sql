-- Regression checks for tenant isolation.
-- Read-only assertions except for request-local JWT claim simulation.

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      coalesce(qual, '') ILIKE '%NOT private.has_any_active_tenant_membership()%'
      OR coalesce(with_check, '') ILIKE '%NOT private.has_any_active_tenant_membership()%'
    );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TENANT_RLS_BYPASS_PRESENT: % policies still fail open', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.tenant_user_permissions p
  LEFT JOIN public.tenant_memberships m
    ON m.tenant_id = p.tenant_id
   AND m.user_id = p.user_id
   AND m.active
  WHERE m.user_id IS NULL;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ORPHAN_TENANT_PERMISSIONS: % rows without active membership', v_count;
  END IF;
END
$$;

DO $$
DECLARE
  v_tenant uuid;
  v_can_view boolean;
  v_can_update boolean;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'NO_TENANT_AVAILABLE_FOR_TEST';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001',
    true
  );

  v_can_view := private.has_tenant_module_permission(v_tenant, 'catalog', 'view');
  v_can_update := private.has_tenant_module_permission(v_tenant, 'catalog', 'update');

  IF v_can_view OR v_can_update OR private.has_any_active_tenant_membership() THEN
    RAISE EXCEPTION 'NO_MEMBERSHIP_USER_MUST_FAIL_CLOSED';
  END IF;
END
$$;

SELECT 'TENANT_RLS_NO_MEMBERSHIP_BYPASS_OK' AS result;
