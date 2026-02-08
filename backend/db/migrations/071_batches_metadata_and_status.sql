-- Add operational metadata to batches (timestamps, status/hold, source attribution).

BEGIN;

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_source_type text,
  ADD COLUMN IF NOT EXISTS received_source_id uuid,
  ADD COLUMN IF NOT EXISTS received_supplier_id uuid REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS notes text;

-- Backfill (if the table existed before these columns).
UPDATE batches SET created_at = now() WHERE created_at IS NULL;
UPDATE batches SET updated_at = now() WHERE updated_at IS NULL;
UPDATE batches SET status = 'available' WHERE status IS NULL;

-- Keep status constrained but flexible.
ALTER TABLE batches DROP CONSTRAINT IF EXISTS chk_batches_status;
ALTER TABLE batches
  ADD CONSTRAINT chk_batches_status
  CHECK (status IN ('available', 'quarantine', 'expired'));

-- Updated-at trigger (reuse set_updated_at() from 022_catalog_timestamps.sql if present).
DROP TRIGGER IF EXISTS trg_batches_updated_at ON batches;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_batches_updated_at
      BEFORE UPDATE ON batches
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_batches_company_item_expiry
  ON batches(company_id, item_id, expiry_date);

CREATE INDEX IF NOT EXISTS idx_batches_company_status_expiry
  ON batches(company_id, status, expiry_date);

COMMIT;

