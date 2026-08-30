-- Private staging for Bling backup migration.
-- Product source rows can be stored as JSON because they do not contain customer PII.
-- Contact source rows are encrypted with the existing private PII encryption key.

CREATE TABLE IF NOT EXISTS private.migration_staging_products (
  batch_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  row_no integer NOT NULL CHECK (row_no > 0),
  external_id text NOT NULL,
  normalized_sku text,
  normalized_gtin text,
  normalized_supplier_code text,
  situation text,
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, external_id),
  FOREIGN KEY (batch_id, tenant_id)
    REFERENCES public.migration_batches(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_migration_stage_products_sku
  ON private.migration_staging_products(tenant_id, normalized_sku)
  WHERE normalized_sku IS NOT NULL AND normalized_sku <> '';
CREATE INDEX IF NOT EXISTS idx_migration_stage_products_gtin
  ON private.migration_staging_products(tenant_id, normalized_gtin)
  WHERE normalized_gtin IS NOT NULL AND normalized_gtin <> '';
CREATE INDEX IF NOT EXISTS idx_migration_stage_products_supplier_code
  ON private.migration_staging_products(tenant_id, normalized_supplier_code)
  WHERE normalized_supplier_code IS NOT NULL AND normalized_supplier_code <> '';

CREATE TABLE IF NOT EXISTS private.migration_staging_contacts (
  batch_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  row_no integer NOT NULL CHECK (row_no > 0),
  external_id text NOT NULL,
  contact_kind text,
  situation text,
  document_hash text,
  email_hash text,
  phone_hash text,
  name_hash text,
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  payload_enc bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, external_id),
  FOREIGN KEY (batch_id, tenant_id)
    REFERENCES public.migration_batches(id, tenant_id) ON DELETE CASCADE,
  CHECK (document_hash IS NULL OR document_hash ~ '^[a-f0-9]{64}$'),
  CHECK (email_hash IS NULL OR email_hash ~ '^[a-f0-9]{64}$'),
  CHECK (phone_hash IS NULL OR phone_hash ~ '^[a-f0-9]{64}$'),
  CHECK (name_hash IS NULL OR name_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_migration_stage_contacts_document
  ON private.migration_staging_contacts(tenant_id, document_hash)
  WHERE document_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_migration_stage_contacts_email
  ON private.migration_staging_contacts(tenant_id, email_hash)
  WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_migration_stage_contacts_phone
  ON private.migration_staging_contacts(tenant_id, phone_hash)
  WHERE phone_hash IS NOT NULL;

COMMENT ON TABLE private.migration_staging_products IS
  'Private raw staging for Bling product backup rows. Never exposed through PostgREST.';
COMMENT ON TABLE private.migration_staging_contacts IS
  'Private encrypted staging for Bling contact backup rows. PII payload is encrypted with private.encrypt_user_pii().';

REVOKE ALL ON private.migration_staging_products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON private.migration_staging_contacts FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.migration_staging_products TO service_role;
GRANT ALL ON private.migration_staging_contacts TO service_role;
