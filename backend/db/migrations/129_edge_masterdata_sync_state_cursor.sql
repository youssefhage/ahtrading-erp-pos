-- Upgrade edge masterdata sync cursor to a composite (updated_at, id).
-- This prevents missing rows when paging through many rows that share the same updated_at timestamp.

BEGIN;

ALTER TABLE edge_masterdata_sync_state
  ADD COLUMN IF NOT EXISTS cursor_ts timestamptz,
  ADD COLUMN IF NOT EXISTS cursor_id uuid;

-- Backfill from the legacy cursor_at field when present.
UPDATE edge_masterdata_sync_state
SET cursor_ts = COALESCE(cursor_ts, cursor_at),
    cursor_id = COALESCE(cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)
WHERE cursor_ts IS NULL OR cursor_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_edge_masterdata_sync_state_company_entity_ts
  ON edge_masterdata_sync_state(company_id, entity, cursor_ts);

COMMIT;

