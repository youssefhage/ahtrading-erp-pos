-- POS module audit fixes: constraints, indexes, and shift uniqueness

-- Note: C-5 (one open shift per device) already handled by migration 053.

-- M-22: CHECK constraint on cash movement types
DO $$ BEGIN
  ALTER TABLE pos_cash_movements
    ADD CONSTRAINT chk_pos_cash_movements_type
    CHECK (movement_type IN ('cash_in', 'cash_out', 'paid_out', 'safe_drop', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- M-23: CHECK constraint on shift status
DO $$ BEGIN
  ALTER TABLE pos_shifts
    ADD CONSTRAINT chk_pos_shifts_status
    CHECK (status IN ('open', 'closed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- M-24: CHECK constraint on outbox event status
DO $$ BEGIN
  ALTER TABLE pos_events_outbox
    ADD CONSTRAINT chk_pos_events_outbox_status
    CHECK (status IN ('pending', 'acked', 'processed', 'failed', 'dead'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- M-25: Index on outbox device_id for device-specific queries
CREATE INDEX IF NOT EXISTS idx_pos_events_outbox_device
  ON pos_events_outbox (device_id);

-- M-26: Index on sales_invoices customer_id for customer lookups
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer
  ON sales_invoices (company_id, customer_id);

-- Additional: Index on tax_lines source lookup
CREATE INDEX IF NOT EXISTS idx_tax_lines_source
  ON tax_lines (source_type, source_id);
