-- Sales ops metadata on sales invoices (optional, non-financial).

BEGIN;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS salesperson_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS sales_channel text,
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_phone text,
  ADD COLUMN IF NOT EXISTS shipping_method text,
  ADD COLUMN IF NOT EXISTS tracking_no text,
  ADD COLUMN IF NOT EXISTS shipping_notes text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_salesperson
  ON sales_invoices(company_id, salesperson_user_id)
  WHERE salesperson_user_id IS NOT NULL;

COMMIT;

