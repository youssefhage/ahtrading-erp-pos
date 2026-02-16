-- Optional assignment of POS cashiers to specific POS devices.
-- If a device has one or more assignments, only those active cashiers are exposed to that device.

CREATE TABLE IF NOT EXISTS pos_device_cashiers (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES pos_cashiers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, cashier_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_device_cashiers_company_device
  ON pos_device_cashiers(company_id, device_id);

CREATE INDEX IF NOT EXISTS idx_pos_device_cashiers_company_cashier
  ON pos_device_cashiers(company_id, cashier_id);

ALTER TABLE pos_device_cashiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_device_cashiers_isolation ON pos_device_cashiers;
CREATE POLICY pos_device_cashiers_isolation
  ON pos_device_cashiers
  USING (company_id = app_current_company_id());
