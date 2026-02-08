-- Store branch attribution and receipt-print metadata on sales documents.
-- This improves reporting/audit (branch_id) and compliance/ops (receipt identifiers).

BEGIN;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id),
  ADD COLUMN IF NOT EXISTS receipt_no text,
  ADD COLUMN IF NOT EXISTS receipt_seq integer,
  ADD COLUMN IF NOT EXISTS receipt_printer text,
  ADD COLUMN IF NOT EXISTS receipt_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_meta jsonb;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_branch
  ON sales_invoices(company_id, branch_id)
  WHERE branch_id IS NOT NULL;

-- Unique receipt sequence per device (when provided).
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_invoices_device_receipt_seq
  ON sales_invoices(company_id, device_id, receipt_seq)
  WHERE device_id IS NOT NULL AND receipt_seq IS NOT NULL;

-- Best-effort backfill branch_id from POS device.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_invoices' AND column_name='device_id') THEN
    UPDATE sales_invoices si
    SET branch_id = d.branch_id
    FROM pos_devices d
    WHERE d.id = si.device_id
      AND si.branch_id IS NULL
      AND d.branch_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_sales_returns_company_branch
  ON sales_returns(company_id, branch_id)
  WHERE branch_id IS NOT NULL;

-- Best-effort backfill sales return branch_id from POS device.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_returns' AND column_name='device_id') THEN
    UPDATE sales_returns r
    SET branch_id = d.branch_id
    FROM pos_devices d
    WHERE d.id = r.device_id
      AND r.branch_id IS NULL
      AND d.branch_id IS NOT NULL;
  END IF;
END $$;

COMMIT;

