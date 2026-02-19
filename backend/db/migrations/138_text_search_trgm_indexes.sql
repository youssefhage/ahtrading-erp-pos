-- Speed up ILIKE-heavy lookups on large datasets (catalog, customers, sales docs).
-- These indexes complement existing (company_id, ...) btree indexes and are
-- especially helpful for contains-search patterns like `%term%`.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Catalog item search.
CREATE INDEX IF NOT EXISTS idx_items_sku_trgm
  ON items USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_items_name_trgm
  ON items USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_items_barcode_trgm
  ON items USING gin (barcode gin_trgm_ops)
  WHERE barcode IS NOT NULL;

-- Alternate barcode search.
CREATE INDEX IF NOT EXISTS idx_item_barcodes_barcode_trgm
  ON item_barcodes USING gin (barcode gin_trgm_ops);

-- Customer search (name/code/phone/email/membership).
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_code_trgm
  ON customers USING gin (code gin_trgm_ops)
  WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm
  ON customers USING gin (phone gin_trgm_ops)
  WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm
  ON customers USING gin (email gin_trgm_ops)
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_membership_no_trgm
  ON customers USING gin (membership_no gin_trgm_ops)
  WHERE membership_no IS NOT NULL;

-- Invoice quick search by number.
CREATE INDEX IF NOT EXISTS idx_sales_invoices_invoice_no_trgm
  ON sales_invoices USING gin (invoice_no gin_trgm_ops)
  WHERE invoice_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoices_receipt_no_trgm
  ON sales_invoices USING gin (receipt_no gin_trgm_ops)
  WHERE receipt_no IS NOT NULL;
