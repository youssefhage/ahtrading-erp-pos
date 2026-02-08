-- Bin/location support (v1):
-- - warehouse_locations master table
-- - optional location_id on stock_moves for placement/traceability

BEGIN;

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, warehouse_id, code)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_locations_company_warehouse
  ON warehouse_locations(company_id, warehouse_id, is_active, code);

ALTER TABLE warehouse_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS warehouse_locations_isolation ON warehouse_locations;
CREATE POLICY warehouse_locations_isolation
  ON warehouse_locations USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_warehouse_locations_updated_at ON warehouse_locations;
CREATE TRIGGER trg_warehouse_locations_updated_at
  BEFORE UPDATE ON warehouse_locations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE stock_moves
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES warehouse_locations(id);

CREATE INDEX IF NOT EXISTS idx_stock_moves_company_warehouse_location
  ON stock_moves(company_id, warehouse_id, location_id)
  WHERE location_id IS NOT NULL;

COMMIT;

