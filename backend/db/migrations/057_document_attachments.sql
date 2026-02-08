-- Generic document attachments stored in Postgres (bytea). Keep small in v1.

BEGIN;

CREATE TABLE IF NOT EXISTS document_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes integer NOT NULL DEFAULT 0,
  sha256 text,
  bytes bytea,
  uploaded_by_user_id uuid REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_attachments_entity
  ON document_attachments(company_id, entity_type, entity_id, uploaded_at DESC);

ALTER TABLE document_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_attachments_isolation ON document_attachments;
CREATE POLICY document_attachments_isolation ON document_attachments
  USING (company_id = app_current_company_id());

COMMIT;

