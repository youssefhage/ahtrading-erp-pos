-- Link POS cashiers to user accounts (employees) and allow assigning employees per POS device.

ALTER TABLE pos_cashiers
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_pos_cashiers_company_user
  ON pos_cashiers(company_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_cashiers_company_user_unique
  ON pos_cashiers(company_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_device_users (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_device_users_company_device
  ON pos_device_users(company_id, device_id);

CREATE INDEX IF NOT EXISTS idx_pos_device_users_company_user
  ON pos_device_users(company_id, user_id);

ALTER TABLE pos_device_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_device_users_isolation ON pos_device_users;
CREATE POLICY pos_device_users_isolation
  ON pos_device_users
  USING (company_id = app_current_company_id());
