-- Add unit precision for UOMs.
--
-- Used by item UOM conversion endpoints and UIs (for proper rounding/display).
-- Existing rows default to 6 decimals, which is safe for most inventory use-cases.

BEGIN;

ALTER TABLE unit_of_measures
  ADD COLUMN IF NOT EXISTS precision int NOT NULL DEFAULT 6;

COMMIT;

