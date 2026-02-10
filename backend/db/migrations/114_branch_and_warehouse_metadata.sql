-- Branch-level configuration + richer warehouse metadata.

BEGIN;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS default_warehouse_id uuid REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS invoice_prefix text,
  ADD COLUMN IF NOT EXISTS operating_hours jsonb;

CREATE INDEX IF NOT EXISTS idx_branches_company_default_warehouse
  ON branches(company_id, default_warehouse_id)
  WHERE default_warehouse_id IS NOT NULL;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS is_virtual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS binning_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capacity_note text;

COMMIT;

