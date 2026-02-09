-- Async supplier invoice import state (queue-first UX).
-- Allows the upload endpoint to return quickly (draft + attachment),
-- while a worker job fills the draft later.

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS import_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS import_error text,
  ADD COLUMN IF NOT EXISTS import_attachment_id uuid,
  ADD COLUMN IF NOT EXISTS import_options_json jsonb,
  ADD COLUMN IF NOT EXISTS import_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS import_finished_at timestamptz;

DO $$
BEGIN
  ALTER TABLE supplier_invoices
    ADD CONSTRAINT supplier_invoices_import_status_check
    CHECK (import_status IN ('none','pending','processing','filled','failed','skipped'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

