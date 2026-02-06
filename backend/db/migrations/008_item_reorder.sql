-- Reorder parameters for AI inventory

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS reorder_point numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_qty numeric(18,4) NOT NULL DEFAULT 0;
