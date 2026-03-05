-- Add line_no column to all document line tables so items display
-- in the order they were entered, not random UUID order.

-- 1. sales_invoice_lines
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS line_no int;

UPDATE sales_invoice_lines SET line_no = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY id) AS rn
  FROM sales_invoice_lines
) sub
WHERE sales_invoice_lines.id = sub.id AND sales_invoice_lines.line_no IS NULL;

ALTER TABLE sales_invoice_lines ALTER COLUMN line_no SET NOT NULL;
ALTER TABLE sales_invoice_lines ALTER COLUMN line_no SET DEFAULT 1;

-- 2. purchase_order_lines
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS line_no int;

UPDATE purchase_order_lines SET line_no = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY purchase_order_id ORDER BY id) AS rn
  FROM purchase_order_lines
) sub
WHERE purchase_order_lines.id = sub.id AND purchase_order_lines.line_no IS NULL;

ALTER TABLE purchase_order_lines ALTER COLUMN line_no SET NOT NULL;
ALTER TABLE purchase_order_lines ALTER COLUMN line_no SET DEFAULT 1;

-- 3. goods_receipt_lines
ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS line_no int;

UPDATE goods_receipt_lines SET line_no = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY goods_receipt_id ORDER BY id) AS rn
  FROM goods_receipt_lines
) sub
WHERE goods_receipt_lines.id = sub.id AND goods_receipt_lines.line_no IS NULL;

ALTER TABLE goods_receipt_lines ALTER COLUMN line_no SET NOT NULL;
ALTER TABLE goods_receipt_lines ALTER COLUMN line_no SET DEFAULT 1;

-- 4. supplier_invoice_lines
ALTER TABLE supplier_invoice_lines ADD COLUMN IF NOT EXISTS line_no int;

UPDATE supplier_invoice_lines SET line_no = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY supplier_invoice_id ORDER BY id) AS rn
  FROM supplier_invoice_lines
) sub
WHERE supplier_invoice_lines.id = sub.id AND supplier_invoice_lines.line_no IS NULL;

ALTER TABLE supplier_invoice_lines ALTER COLUMN line_no SET NOT NULL;
ALTER TABLE supplier_invoice_lines ALTER COLUMN line_no SET DEFAULT 1;
