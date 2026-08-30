-- Service-role only ingestion RPC used by the audited Bling backup staging pipeline.
-- It accepts normalized product keys and hashed contact keys only.

CREATE OR REPLACE FUNCTION public.ingest_bling_stage_rows(
  p_batch_id uuid,
  p_tenant_id uuid,
  p_module text,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.migration_batches
    WHERE id = p_batch_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'migration batch not found';
  END IF;

  IF p_module = 'products' THEN
    INSERT INTO private.migration_staging_products (
      batch_id, tenant_id, row_no, external_id, normalized_sku,
      normalized_gtin, normalized_supplier_code, situation,
      source_checksum, payload
    )
    SELECT
      p_batch_id,
      p_tenant_id,
      x.row_no,
      x.external_id,
      nullif(x.sku, ''),
      nullif(x.gtin, ''),
      nullif(x.supplier_code, ''),
      nullif(x.situation, ''),
      encode(digest(concat_ws('|', x.external_id, x.sku, x.gtin, x.supplier_code, x.situation), 'sha256'), 'hex'),
      '{}'::jsonb
    FROM jsonb_to_recordset(p_rows) AS x(
      row_no integer,
      external_id text,
      sku text,
      gtin text,
      supplier_code text,
      situation text
    )
    ON CONFLICT (batch_id, external_id) DO UPDATE SET
      row_no = EXCLUDED.row_no,
      normalized_sku = EXCLUDED.normalized_sku,
      normalized_gtin = EXCLUDED.normalized_gtin,
      normalized_supplier_code = EXCLUDED.normalized_supplier_code,
      situation = EXCLUDED.situation,
      source_checksum = EXCLUDED.source_checksum;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_module = 'contacts' THEN
    INSERT INTO private.migration_staging_contacts (
      batch_id, tenant_id, row_no, external_id, contact_kind, situation,
      document_hash, email_hash, phone_hash, name_hash,
      source_checksum, payload_enc
    )
    SELECT
      p_batch_id,
      p_tenant_id,
      x.row_no,
      x.external_id,
      nullif(x.kind, ''),
      nullif(x.situation, ''),
      nullif(x.document_hash, ''),
      nullif(x.email_hash, ''),
      nullif(x.phone_hash, ''),
      nullif(x.name_hash, ''),
      encode(digest(concat_ws('|', x.external_id, x.kind, x.situation, x.document_hash, x.email_hash, x.phone_hash, x.name_hash), 'sha256'), 'hex'),
      private.encrypt_user_pii('{}')
    FROM jsonb_to_recordset(p_rows) AS x(
      row_no integer,
      external_id text,
      kind text,
      situation text,
      document_hash text,
      email_hash text,
      phone_hash text,
      name_hash text
    )
    ON CONFLICT (batch_id, external_id) DO UPDATE SET
      row_no = EXCLUDED.row_no,
      contact_kind = EXCLUDED.contact_kind,
      situation = EXCLUDED.situation,
      document_hash = EXCLUDED.document_hash,
      email_hash = EXCLUDED.email_hash,
      phone_hash = EXCLUDED.phone_hash,
      name_hash = EXCLUDED.name_hash,
      source_checksum = EXCLUDED.source_checksum;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'unsupported migration module';
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_bling_stage_rows(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_bling_stage_rows(uuid, uuid, text, jsonb) TO service_role;
