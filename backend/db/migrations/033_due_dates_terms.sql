-- Payment terms + invoice/due dates for AR/AP aging and credit management.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS due_date date;

-- Backfill existing documents from created_at, then apply terms where possible.
UPDATE sales_invoices
SET invoice_date = created_at::date
WHERE invoice_date IS NULL;

UPDATE supplier_invoices
SET invoice_date = created_at::date
WHERE invoice_date IS NULL;

UPDATE sales_invoices si
SET due_date = (si.invoice_date + COALESCE(c.payment_terms_days, 0))
FROM customers c
WHERE si.due_date IS NULL
  AND si.customer_id IS NOT NULL
  AND c.company_id = si.company_id
  AND c.id = si.customer_id;

UPDATE supplier_invoices si
SET due_date = (si.invoice_date + COALESCE(s.payment_terms_days, 0))
FROM suppliers s
WHERE si.due_date IS NULL
  AND si.supplier_id IS NOT NULL
  AND s.company_id = si.company_id
  AND s.id = si.supplier_id;

-- Default remaining due dates to the invoice_date.
UPDATE sales_invoices
SET due_date = invoice_date
WHERE due_date IS NULL;

UPDATE supplier_invoices
SET due_date = invoice_date
WHERE due_date IS NULL;

ALTER TABLE sales_invoices
  ALTER COLUMN invoice_date SET NOT NULL,
  ALTER COLUMN due_date SET NOT NULL;

ALTER TABLE supplier_invoices
  ALTER COLUMN invoice_date SET NOT NULL,
  ALTER COLUMN due_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_due
  ON sales_invoices (company_id, due_date);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company_due
  ON supplier_invoices (company_id, due_date);

