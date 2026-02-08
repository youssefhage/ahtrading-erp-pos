-- Reserved/committed quantities v1: allow drafts to explicitly reserve stock (affects availability reporting).
-- This does NOT create stock moves; it only affects reporting and allocation decisions at post time.

BEGIN;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS reserve_stock boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_reserve_stock
  ON sales_invoices(company_id, status, reserve_stock, warehouse_id)
  WHERE reserve_stock = true;

COMMIT;

