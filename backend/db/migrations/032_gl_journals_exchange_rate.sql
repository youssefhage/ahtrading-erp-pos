-- Store the exchange rate used to derive dual-currency amounts for better auditability.
-- Existing rows default to 0; new code should populate it when known.

ALTER TABLE gl_journals
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6) NOT NULL DEFAULT 0;

