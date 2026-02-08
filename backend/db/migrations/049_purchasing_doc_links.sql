-- Link purchasing documents so workflows are traceable and matching is possible.

ALTER TABLE goods_receipts
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid NULL REFERENCES purchase_orders(id);

ALTER TABLE goods_receipt_lines
  ADD COLUMN IF NOT EXISTS purchase_order_line_id uuid NULL REFERENCES purchase_order_lines(id);

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS goods_receipt_id uuid NULL REFERENCES goods_receipts(id);

ALTER TABLE supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS goods_receipt_line_id uuid NULL REFERENCES goods_receipt_lines(id);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_company_po
  ON goods_receipts(company_id, purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_company_po_line
  ON goods_receipt_lines(company_id, purchase_order_line_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company_gr
  ON supplier_invoices(company_id, goods_receipt_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_company_gr_line
  ON supplier_invoice_lines(company_id, goods_receipt_line_id);
