-- Attachments storage v2: allow storing payloads in S3/MinIO while keeping metadata in Postgres.
-- Backwards compatible with v1 (bytea) storage.

BEGIN;

ALTER TABLE document_attachments
  ADD COLUMN IF NOT EXISTS storage_backend text NOT NULL DEFAULT 'db', -- 'db' | 's3'
  ADD COLUMN IF NOT EXISTS object_bucket text,
  ADD COLUMN IF NOT EXISTS object_key text,
  ADD COLUMN IF NOT EXISTS object_etag text;

ALTER TABLE document_attachments
  DROP CONSTRAINT IF EXISTS document_attachments_storage_backend_check;
ALTER TABLE document_attachments
  ADD CONSTRAINT document_attachments_storage_backend_check
  CHECK (storage_backend IN ('db', 's3'));

CREATE INDEX IF NOT EXISTS idx_document_attachments_object_key
  ON document_attachments(company_id, object_key)
  WHERE object_key IS NOT NULL;

COMMIT;

