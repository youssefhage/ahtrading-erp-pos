-- Improve auditability for system-generated journals by attributing device/cashier.
-- Also adds basic dimensions on entries (branch/warehouse) for reporting.

BEGIN;

ALTER TABLE gl_journals
  ADD COLUMN IF NOT EXISTS created_by_device_id uuid REFERENCES pos_devices(id),
  ADD COLUMN IF NOT EXISTS created_by_cashier_id uuid REFERENCES pos_cashiers(id);

ALTER TABLE gl_entries
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id),
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);

CREATE INDEX IF NOT EXISTS idx_gl_entries_branch ON gl_entries(branch_id);
CREATE INDEX IF NOT EXISTS idx_gl_entries_warehouse ON gl_entries(warehouse_id);

COMMIT;

