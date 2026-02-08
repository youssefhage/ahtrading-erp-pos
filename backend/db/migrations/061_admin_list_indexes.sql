-- Admin v2: indexes for server-side pagination/filtering.
-- Safe to apply multiple times.

-- Sales invoices list
CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_created_at
  ON sales_invoices (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_status
  ON sales_invoices (company_id, status);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_invoice_no
  ON sales_invoices (company_id, invoice_no);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_customer_id
  ON sales_invoices (company_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_invoice_date
  ON sales_invoices (company_id, invoice_date);

-- Items list/search
CREATE INDEX IF NOT EXISTS idx_items_company_name
  ON items (company_id, name);

CREATE INDEX IF NOT EXISTS idx_items_company_is_active
  ON items (company_id, is_active);

-- Customers list/search
CREATE INDEX IF NOT EXISTS idx_customers_company_is_active
  ON customers (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_customers_company_updated_at
  ON customers (company_id, updated_at DESC);

-- POS outbox (ops portal / troubleshooting)
CREATE INDEX IF NOT EXISTS idx_pos_events_outbox_status_created_at
  ON pos_events_outbox (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_events_outbox_device_created_at
  ON pos_events_outbox (device_id, created_at DESC);

