-- Device activity tracking for admin visibility.

ALTER TABLE pos_devices
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_status text;

CREATE INDEX IF NOT EXISTS idx_pos_devices_company_last_seen
  ON pos_devices(company_id, last_seen_at DESC NULLS LAST);
