-- Add idempotency columns for bulk price imports.
-- Required by /items/prices/bulk which upserts via (source_type, source_id).

BEGIN;

ALTER TABLE item_prices
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

-- Uniqueness for ON CONFLICT inference. NULLs are allowed for legacy rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_prices_source
  ON item_prices(source_type, source_id);

COMMIT;

