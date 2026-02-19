-- Normalize and enforce sales invoice source channel for reliable reporting/audit.

BEGIN;

UPDATE sales_invoices
SET sales_channel = CASE
  WHEN lower(trim(coalesce(sales_channel, ''))) IN ('pos', 'admin', 'import', 'api')
    THEN lower(trim(sales_channel))
  WHEN source_event_id IS NOT NULL OR device_id IS NOT NULL
    THEN 'pos'
  ELSE 'admin'
END
WHERE sales_channel IS NULL
   OR trim(coalesce(sales_channel, '')) = ''
   OR lower(trim(coalesce(sales_channel, ''))) NOT IN ('pos', 'admin', 'import', 'api');

ALTER TABLE sales_invoices
  ALTER COLUMN sales_channel SET DEFAULT 'admin';

ALTER TABLE sales_invoices
  ALTER COLUMN sales_channel SET NOT NULL;

ALTER TABLE sales_invoices
  DROP CONSTRAINT IF EXISTS ck_sales_invoices_sales_channel;

ALTER TABLE sales_invoices
  ADD CONSTRAINT ck_sales_invoices_sales_channel
  CHECK (sales_channel IN ('pos', 'admin', 'import', 'api'));

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_sales_channel_created
  ON sales_invoices(company_id, sales_channel, created_at DESC);

COMMIT;

