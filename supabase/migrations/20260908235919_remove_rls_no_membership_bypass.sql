-- Remove the legacy fail-open clause from tenant permission policies.
-- A signed-in user without an active tenant membership must never gain access
-- merely because they have no membership. Authorization is delegated solely to
-- private.has_tenant_module_permission(...), which fails closed without an
-- active membership and applies role/module overrides for valid members.

DO $$
DECLARE
  r record;
  v_using text;
  v_check text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'tenant_user_permission_%'
      AND (
        coalesce(qual, '') LIKE '%NOT private.has_any_active_tenant_membership()%'
        OR coalesce(with_check, '') LIKE '%NOT private.has_any_active_tenant_membership()%'
      )
  LOOP
    v_using := CASE
      WHEN r.qual IS NULL THEN NULL
      ELSE replace(r.qual, '((NOT private.has_any_active_tenant_membership()) OR ', '(')
    END;

    v_check := CASE
      WHEN r.with_check IS NULL THEN NULL
      ELSE replace(r.with_check, '((NOT private.has_any_active_tenant_membership()) OR ', '(')
    END;

    CASE r.cmd
      WHEN 'SELECT' THEN
        EXECUTE format(
          'ALTER POLICY %I ON %I.%I USING (%s)',
          r.policyname, r.schemaname, r.tablename, v_using
        );
      WHEN 'DELETE' THEN
        EXECUTE format(
          'ALTER POLICY %I ON %I.%I USING (%s)',
          r.policyname, r.schemaname, r.tablename, v_using
        );
      WHEN 'INSERT' THEN
        EXECUTE format(
          'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
          r.policyname, r.schemaname, r.tablename, v_check
        );
      WHEN 'UPDATE' THEN
        EXECUTE format(
          'ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
          r.policyname, r.schemaname, r.tablename, v_using, v_check
        );
      WHEN 'ALL' THEN
        EXECUTE format(
          'ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
          r.policyname, r.schemaname, r.tablename, v_using, v_check
        );
    END CASE;
  END LOOP;
END
$$;
