-- Warehouse-level expiry picking policy (v1):
-- enforce a minimum shelf-life window for sales allocations by default.

BEGIN;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS min_shelf_life_days_for_sale_default integer NOT NULL DEFAULT 0;

ALTER TABLE warehouses
  DROP CONSTRAINT IF EXISTS chk_warehouses_min_shelf_life_days_for_sale_default;
ALTER TABLE warehouses
  ADD CONSTRAINT chk_warehouses_min_shelf_life_days_for_sale_default
  CHECK (min_shelf_life_days_for_sale_default >= 0);

COMMIT;

