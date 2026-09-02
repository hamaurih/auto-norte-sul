-- Keep Bling operational logs tenant-scoped and aligned with the server runtime.
-- This migration is intentionally idempotent because some environments received
-- parts of the Phase 1 schema before the full migration was applied.

ALTER TABLE public.bling_sync_logs
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

DO $$
DECLARE
  v_null_rows bigint;
  v_config_tenants bigint;
  v_tenant_id uuid;
BEGIN
  SELECT count(*) INTO v_null_rows
  FROM public.bling_sync_logs
  WHERE tenant_id IS NULL;

  IF v_null_rows > 0 THEN
    SELECT count(DISTINCT tenant_id), min(tenant_id)
      INTO v_config_tenants, v_tenant_id
    FROM public.bling_config
    WHERE tenant_id IS NOT NULL;

    IF v_config_tenants = 1 AND v_tenant_id IS NOT NULL THEN
      UPDATE public.bling_sync_logs
      SET tenant_id = v_tenant_id
      WHERE tenant_id IS NULL;
    ELSE
      RAISE EXCEPTION
        'Cannot safely backfill %.bling_sync_logs rows: found % configured tenants',
        v_null_rows,
        v_config_tenants;
    END IF;
  END IF;
END $$;

ALTER TABLE public.bling_sync_logs
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bling_sync_logs_tenant_created
  ON public.bling_sync_logs(tenant_id, created_at DESC);

ALTER TABLE public.bling_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_logs_staff_read" ON public.bling_sync_logs;
DROP POLICY IF EXISTS "Bling tenant logs read" ON public.bling_sync_logs;

CREATE POLICY "Bling tenant logs read"
ON public.bling_sync_logs
FOR SELECT TO authenticated
USING (
  private.has_tenant_role(
    tenant_id,
    ARRAY['owner','admin','manager']::text[]
  )
);

GRANT SELECT ON public.bling_sync_logs TO authenticated;
GRANT ALL ON public.bling_sync_logs TO service_role;

NOTIFY pgrst, 'reload schema';
