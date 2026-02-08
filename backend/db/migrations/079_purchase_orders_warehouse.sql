-- Add warehouse context to purchase orders (required by API and for incoming/committed inventory reporting).
-- NULL means "unknown" for legacy rows; API now always sets it for new POs.

BEGIN;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_warehouse
  ON purchase_orders(company_id, warehouse_id)
  WHERE warehouse_id IS NOT NULL;

COMMIT;

