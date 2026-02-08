-- Enforce "one open shift per device" at the DB level to prevent race conditions.

CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_shifts_one_open_per_device
ON pos_shifts(company_id, device_id)
WHERE status = 'open';

