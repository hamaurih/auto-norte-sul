-- Central de Migração Bling -> Norte Sul
-- Safe historical migration control plane. This schema intentionally stores
-- counters/checksums/reconciliation metadata, never raw backup PII.

CREATE TABLE IF NOT EXISTS public.migration_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_system text NOT NULL DEFAULT 'bling_backup' CHECK (source_system IN ('bling_backup','bling_api','manual_import')),
  source_name text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 300),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_size_bytes bigint NOT NULL DEFAULT 0 CHECK (source_size_bytes >= 0),
  status text NOT NULL DEFAULT 'analyzed' CHECK (status IN (
    'analyzed','staging','ready','running','paused','completed','completed_with_errors','cancelled'
  )),
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_run_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, source_sha256)
);

CREATE TABLE IF NOT EXISTS public.migration_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.migration_batches(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module_key text NOT NULL CHECK (module_key IN (
    'contacts','products','purchase_orders','sales_orders','cash_bank',
    'accounts_receivable','accounts_payable','stock','nfe'
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','analyzed','staging','ready','running','paused','completed','reconciled','error','cancelled'
  )),
  source_rows bigint NOT NULL DEFAULT 0 CHECK (source_rows >= 0),
  source_entities bigint NOT NULL DEFAULT 0 CHECK (source_entities >= 0),
  staged_count bigint NOT NULL DEFAULT 0 CHECK (staged_count >= 0),
  matched_count bigint NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  created_count bigint NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count bigint NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count bigint NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  error_count bigint NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  quarantined_count bigint NOT NULL DEFAULT 0 CHECK (quarantined_count >= 0),
  reconciled_count bigint NOT NULL DEFAULT 0 CHECK (reconciled_count >= 0),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, module_key),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (batch_id, tenant_id) REFERENCES public.migration_batches(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.migration_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.migration_batches(id) ON DELETE CASCADE,
  module_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  row_key text NOT NULL CHECK (char_length(row_key) BETWEEN 1 AND 500),
  external_id text,
  external_parent_id text,
  source_checksum text CHECK (source_checksum IS NULL OR source_checksum ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN (
    'staged','matched','created','updated','skipped','error','quarantined','reconciled'
  )),
  target_table text,
  target_id text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_attempt_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, module_key, row_key),
  FOREIGN KEY (module_id, tenant_id) REFERENCES public.migration_modules(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id, tenant_id) REFERENCES public.migration_batches(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.migration_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.migration_batches(id) ON DELETE CASCADE,
  module_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  metric_key text NOT NULL CHECK (char_length(metric_key) BETWEEN 1 AND 120),
  source_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  target_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  delta_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','match','warning','mismatch','accepted')),
  details text,
  checked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, module_key, metric_key),
  FOREIGN KEY (module_id, tenant_id) REFERENCES public.migration_modules(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id, tenant_id) REFERENCES public.migration_batches(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.migration_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.migration_batches(id) ON DELETE CASCADE,
  module_id uuid,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('analyze','stage','run','pause','resume','retry','reconcile','cancel')),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','success','error','cancelled')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  processed_count bigint NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  error_count bigint NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (module_id, tenant_id) REFERENCES public.migration_modules(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id, tenant_id) REFERENCES public.migration_batches(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_migration_batches_tenant_created
  ON public.migration_batches(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_migration_modules_batch_status
  ON public.migration_modules(batch_id, status, module_key);
CREATE INDEX IF NOT EXISTS idx_migration_records_errors
  ON public.migration_records(tenant_id, batch_id, module_key, status)
  WHERE status IN ('error','quarantined');
CREATE INDEX IF NOT EXISTS idx_migration_records_external
  ON public.migration_records(tenant_id, module_key, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_migration_reconciliation_batch
  ON public.migration_reconciliations(batch_id, module_key, status);
CREATE INDEX IF NOT EXISTS idx_migration_attempts_batch
  ON public.migration_attempts(batch_id, created_at DESC);

COMMENT ON TABLE public.migration_batches IS 'Control plane for audited historical migrations. Raw backup PII must never be stored in manifest/settings.';
COMMENT ON TABLE public.migration_modules IS 'Per-module progress, counters and checkpoints for idempotent migration.';
COMMENT ON TABLE public.migration_records IS 'Per-record idempotency/error ledger. metadata must exclude raw PII and secrets.';
COMMENT ON TABLE public.migration_reconciliations IS 'Source-vs-target reconciliation evidence by migration module.';
COMMENT ON TABLE public.migration_attempts IS 'Append-oriented operational log for analyze/run/retry/reconcile actions.';

CREATE OR REPLACE FUNCTION private.migration_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, private
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_migration_batches_updated_at ON public.migration_batches;
CREATE TRIGGER trg_migration_batches_updated_at
BEFORE UPDATE ON public.migration_batches
FOR EACH ROW EXECUTE FUNCTION private.migration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_migration_modules_updated_at ON public.migration_modules;
CREATE TRIGGER trg_migration_modules_updated_at
BEFORE UPDATE ON public.migration_modules
FOR EACH ROW EXECUTE FUNCTION private.migration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_migration_records_updated_at ON public.migration_records;
CREATE TRIGGER trg_migration_records_updated_at
BEFORE UPDATE ON public.migration_records
FOR EACH ROW EXECUTE FUNCTION private.migration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_migration_reconciliations_updated_at ON public.migration_reconciliations;
CREATE TRIGGER trg_migration_reconciliations_updated_at
BEFORE UPDATE ON public.migration_reconciliations
FOR EACH ROW EXECUTE FUNCTION private.migration_touch_updated_at();

ALTER TABLE public.migration_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.migration_batches FROM anon;
REVOKE ALL ON public.migration_modules FROM anon;
REVOKE ALL ON public.migration_records FROM anon;
REVOKE ALL ON public.migration_reconciliations FROM anon;
REVOKE ALL ON public.migration_attempts FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.migration_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.migration_modules TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.migration_records TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.migration_reconciliations TO authenticated;
GRANT SELECT, INSERT ON public.migration_attempts TO authenticated;
GRANT ALL ON public.migration_batches, public.migration_modules, public.migration_records,
  public.migration_reconciliations, public.migration_attempts TO service_role;

DROP POLICY IF EXISTS "Migration batches tenant read" ON public.migration_batches;
CREATE POLICY "Migration batches tenant read" ON public.migration_batches
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','accountant']::text[]));
DROP POLICY IF EXISTS "Migration batches admin manage" ON public.migration_batches;
CREATE POLICY "Migration batches admin manage" ON public.migration_batches
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "Migration modules tenant read" ON public.migration_modules;
CREATE POLICY "Migration modules tenant read" ON public.migration_modules
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','accountant']::text[]));
DROP POLICY IF EXISTS "Migration modules admin manage" ON public.migration_modules;
CREATE POLICY "Migration modules admin manage" ON public.migration_modules
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "Migration records tenant read" ON public.migration_records;
CREATE POLICY "Migration records tenant read" ON public.migration_records
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','accountant']::text[]));
DROP POLICY IF EXISTS "Migration records admin manage" ON public.migration_records;
CREATE POLICY "Migration records admin manage" ON public.migration_records
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "Migration reconciliations tenant read" ON public.migration_reconciliations;
CREATE POLICY "Migration reconciliations tenant read" ON public.migration_reconciliations
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','accountant']::text[]));
DROP POLICY IF EXISTS "Migration reconciliations admin manage" ON public.migration_reconciliations;
CREATE POLICY "Migration reconciliations admin manage" ON public.migration_reconciliations
FOR ALL TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]))
WITH CHECK (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]));

DROP POLICY IF EXISTS "Migration attempts tenant read" ON public.migration_attempts;
CREATE POLICY "Migration attempts tenant read" ON public.migration_attempts
FOR SELECT TO authenticated
USING (private.has_tenant_role(tenant_id, ARRAY['owner','admin','manager','accountant']::text[]));
DROP POLICY IF EXISTS "Migration attempts admin insert" ON public.migration_attempts;
CREATE POLICY "Migration attempts admin insert" ON public.migration_attempts
FOR INSERT TO authenticated
WITH CHECK (private.has_tenant_role(tenant_id, ARRAY['owner','admin']::text[]));

-- Retry is deliberately conservative: only failed/quarantined ledger rows are
-- returned to staging. The target ERP data is never deleted or rolled back here.
CREATE OR REPLACE FUNCTION public.retry_migration_module(
  p_batch_id uuid,
  p_module_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_tenant_id uuid;
  v_module_id uuid;
  v_reset bigint := 0;
BEGIN
  SELECT b.tenant_id, m.id
    INTO v_tenant_id, v_module_id
  FROM public.migration_batches b
  JOIN public.migration_modules m ON m.batch_id = b.id AND m.tenant_id = b.tenant_id
  WHERE b.id = p_batch_id AND m.module_key = p_module_key;

  IF v_tenant_id IS NULL OR v_module_id IS NULL THEN
    RAISE EXCEPTION 'Migration batch/module not found';
  END IF;

  IF NOT private.has_tenant_role(v_tenant_id, ARRAY['owner','admin']::text[]) THEN
    RAISE EXCEPTION 'Insufficient tenant role';
  END IF;

  UPDATE public.migration_records
  SET status = 'staged',
      error_code = NULL,
      error_message = NULL,
      processed_at = NULL,
      updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND batch_id = p_batch_id
    AND module_id = v_module_id
    AND status IN ('error','quarantined');
  GET DIAGNOSTICS v_reset = ROW_COUNT;

  UPDATE public.migration_modules
  SET status = CASE WHEN v_reset > 0 THEN 'ready' ELSE status END,
      error_count = GREATEST(error_count - v_reset, 0),
      quarantined_count = 0,
      last_error = NULL,
      updated_at = now()
  WHERE id = v_module_id AND tenant_id = v_tenant_id;

  INSERT INTO public.migration_attempts (
    batch_id, module_id, tenant_id, action, status, actor_user_id,
    processed_count, message, finished_at
  ) VALUES (
    p_batch_id, v_module_id, v_tenant_id, 'retry', 'success', auth.uid(),
    v_reset, format('%s registros retornaram ao staging', v_reset), now()
  );

  RETURN jsonb_build_object('ok', true, 'reset_count', v_reset, 'module_key', p_module_key);
END;
$$;

REVOKE ALL ON FUNCTION public.retry_migration_module(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_migration_module(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_migration_module(uuid, text) TO service_role;
