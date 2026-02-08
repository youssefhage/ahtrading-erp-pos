-- Add vendor reference to supplier invoices, with uniqueness per supplier.

BEGIN;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS supplier_ref text;

-- Enforce uniqueness for vendor invoice numbers when present.
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_invoices_supplier_ref
  ON supplier_invoices(company_id, supplier_id, supplier_ref)
  WHERE supplier_ref IS NOT NULL AND supplier_ref <> '' AND status <> 'canceled';

COMMIT;

