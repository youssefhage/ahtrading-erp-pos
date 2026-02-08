-- Add warehouse_id to sales_invoices so non-POS invoices can post inventory/COGS deterministically.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS warehouse_id uuid NULL REFERENCES warehouses(id);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_warehouse
  ON sales_invoices(company_id, warehouse_id);

-- Best-effort backfill from existing stock_moves emitted by POS posting.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stock_moves') THEN
    UPDATE sales_invoices si
    SET warehouse_id = sm.warehouse_id
    FROM (
      -- uuid doesn't support MIN/MAX in Postgres; cast via text for a deterministic pick.
      SELECT source_id::uuid AS invoice_id, MIN(warehouse_id::text)::uuid AS warehouse_id
      FROM stock_moves
      WHERE source_type = 'sales_invoice' AND source_id IS NOT NULL AND warehouse_id IS NOT NULL
      GROUP BY source_id
    ) sm
    WHERE si.id = sm.invoice_id AND si.warehouse_id IS NULL;
  END IF;
END $$;
