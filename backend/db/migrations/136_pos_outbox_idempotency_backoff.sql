-- POS outbox durability and retry scheduling improvements.

ALTER TABLE pos_events_outbox
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_outbox_device_type_idempotency_key
  ON pos_events_outbox (device_id, event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '';

CREATE INDEX IF NOT EXISTS idx_pos_outbox_retry_pick
  ON pos_events_outbox (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');
