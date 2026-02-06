ALTER TABLE pos_devices
ADD COLUMN IF NOT EXISTS device_token_hash text;

CREATE INDEX IF NOT EXISTS idx_pos_devices_token_hash
ON pos_devices(device_token_hash);
