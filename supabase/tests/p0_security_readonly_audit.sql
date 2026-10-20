-- P0 security audit: READ ONLY, no mutations and no credentials.
-- Execute with a privileged auditor to inspect catalog GRANTs/RLS coverage.
BEGIN READ ONLY;
SELECT 'public_tables_without_rls' AS check_name, count(*) AS findings
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
UNION ALL
SELECT 'public_security_definer_executable_by_clients',count(*)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef AND
(has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
UNION ALL
SELECT 'rls_tables_without_policy',count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND
NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid=c.oid)
UNION ALL
SELECT 'public_schema_extensions',count(*)
FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
WHERE n.nspname='public';
ROLLBACK;
