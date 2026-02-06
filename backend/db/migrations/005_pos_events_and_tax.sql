-- POS event tracking + tax line metadata

ALTER TABLE pos_events_outbox
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS source_event_id uuid;

ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS source_event_id uuid;

ALTER TABLE goods_receipts
  ADD COLUMN IF NOT EXISTS source_event_id uuid;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS source_event_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoices_event
  ON sales_invoices (company_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_returns_event
  ON sales_returns (company_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_goods_receipts_event
  ON goods_receipts (company_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_invoices_event
  ON supplier_invoices (company_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

ALTER TABLE tax_lines
  ADD COLUMN IF NOT EXISTS tax_date date,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
