-- Add updated_at tracking for pos_devices so Edge masterdata replication can delta-sync
-- device registrations / token hashes (cloud -> edge).

ALTER TABLE pos_devices
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE pos_devices
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE pos_devices
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_pos_devices_company_updated_at
  ON pos_devices(company_id, updated_at);

-- Updated-at trigger (reuse set_updated_at() from 022_catalog_timestamps.sql if present).
DROP TRIGGER IF EXISTS trg_pos_devices_updated_at ON pos_devices;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_pos_devices_updated_at
      BEFORE UPDATE ON pos_devices
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

