-- POS shift tracking

CREATE TABLE IF NOT EXISTS pos_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  device_id uuid NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid REFERENCES users(id),
  opening_cash_usd numeric(18,4) NOT NULL DEFAULT 0,
  opening_cash_lbp numeric(18,2) NOT NULL DEFAULT 0,
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  closing_cash_usd numeric(18,4) NOT NULL DEFAULT 0,
  closing_cash_lbp numeric(18,2) NOT NULL DEFAULT 0,
  expected_cash_usd numeric(18,4) NOT NULL DEFAULT 0,
  expected_cash_lbp numeric(18,2) NOT NULL DEFAULT 0,
  variance_usd numeric(18,4) NOT NULL DEFAULT 0,
  variance_lbp numeric(18,2) NOT NULL DEFAULT 0,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_pos_shifts_company ON pos_shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_device_status ON pos_shifts(device_id, status);

ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY pos_shifts_isolation
  ON pos_shifts USING (company_id = app_current_company_id());

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES pos_devices(id),
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES pos_shifts(id);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_device ON sales_invoices(company_id, device_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_shift ON sales_invoices(company_id, shift_id);
