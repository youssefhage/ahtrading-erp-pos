-- Persist entered UOM/qty/price/cost alongside base quantities.
--
-- Invariants:
-- - `qty` remains the base quantity (in items.unit_of_measure) used for inventory/costing.
-- - `uom`/`qty_factor`/`qty_entered` preserve what the user entered/scanned.
-- - `*_entered_*` preserve the price/cost per entered unit for auditability and UX.

BEGIN;

-- Sales invoice lines
ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS unit_price_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_price_entered_lbp numeric(18,2);

UPDATE sales_invoice_lines l
SET uom = COALESCE(NULLIF(l.uom, ''), i.unit_of_measure)
FROM sales_invoices si, items i
WHERE si.id = l.invoice_id
  AND i.id = l.item_id
  AND si.company_id = i.company_id
  AND (l.uom IS NULL OR l.uom = '');

UPDATE sales_invoice_lines
SET qty_entered = CASE
  WHEN COALESCE(qty_factor, 1) = 0 THEN qty
  ELSE qty / COALESCE(qty_factor, 1)
END
WHERE qty_entered IS NULL;

UPDATE sales_invoice_lines
SET unit_price_entered_usd = COALESCE(unit_price_entered_usd, unit_price_usd * COALESCE(qty_factor, 1)),
    unit_price_entered_lbp = COALESCE(unit_price_entered_lbp, unit_price_lbp * COALESCE(qty_factor, 1))
WHERE unit_price_entered_usd IS NULL OR unit_price_entered_lbp IS NULL;

ALTER TABLE sales_invoice_lines
  ALTER COLUMN qty_entered SET NOT NULL,
  ALTER COLUMN unit_price_entered_usd SET NOT NULL,
  ALTER COLUMN unit_price_entered_lbp SET NOT NULL;

-- Sales return lines
ALTER TABLE sales_return_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS unit_price_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_price_entered_lbp numeric(18,2),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_lbp numeric(18,2);

UPDATE sales_return_lines l
SET uom = COALESCE(NULLIF(l.uom, ''), i.unit_of_measure)
FROM sales_returns r, items i
WHERE r.id = l.sales_return_id
  AND i.id = l.item_id
  AND r.company_id = i.company_id
  AND (l.uom IS NULL OR l.uom = '');

UPDATE sales_return_lines
SET qty_entered = CASE
  WHEN COALESCE(qty_factor, 1) = 0 THEN qty
  ELSE qty / COALESCE(qty_factor, 1)
END
WHERE qty_entered IS NULL;

UPDATE sales_return_lines
SET unit_price_entered_usd = COALESCE(unit_price_entered_usd, unit_price_usd * COALESCE(qty_factor, 1)),
    unit_price_entered_lbp = COALESCE(unit_price_entered_lbp, unit_price_lbp * COALESCE(qty_factor, 1)),
    unit_cost_entered_usd = COALESCE(unit_cost_entered_usd, unit_cost_usd * COALESCE(qty_factor, 1)),
    unit_cost_entered_lbp = COALESCE(unit_cost_entered_lbp, unit_cost_lbp * COALESCE(qty_factor, 1))
WHERE unit_price_entered_usd IS NULL
   OR unit_price_entered_lbp IS NULL
   OR unit_cost_entered_usd IS NULL
   OR unit_cost_entered_lbp IS NULL;

ALTER TABLE sales_return_lines
  ALTER COLUMN qty_entered SET NOT NULL,
  ALTER COLUMN unit_price_entered_usd SET NOT NULL,
  ALTER COLUMN unit_price_entered_lbp SET NOT NULL,
  ALTER COLUMN unit_cost_entered_usd SET NOT NULL,
  ALTER COLUMN unit_cost_entered_lbp SET NOT NULL;

-- Purchase order lines
ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_lbp numeric(18,2);

UPDATE purchase_order_lines l
SET uom = COALESCE(NULLIF(l.uom, ''), i.unit_of_measure)
FROM purchase_orders po, items i
WHERE po.id = l.purchase_order_id
  AND i.id = l.item_id
  AND po.company_id = i.company_id
  AND (l.uom IS NULL OR l.uom = '');

UPDATE purchase_order_lines
SET qty_entered = CASE
  WHEN COALESCE(qty_factor, 1) = 0 THEN qty
  ELSE qty / COALESCE(qty_factor, 1)
END
WHERE qty_entered IS NULL;

UPDATE purchase_order_lines
SET unit_cost_entered_usd = COALESCE(unit_cost_entered_usd, unit_cost_usd * COALESCE(qty_factor, 1)),
    unit_cost_entered_lbp = COALESCE(unit_cost_entered_lbp, unit_cost_lbp * COALESCE(qty_factor, 1))
WHERE unit_cost_entered_usd IS NULL OR unit_cost_entered_lbp IS NULL;

ALTER TABLE purchase_order_lines
  ALTER COLUMN qty_entered SET NOT NULL,
  ALTER COLUMN unit_cost_entered_usd SET NOT NULL,
  ALTER COLUMN unit_cost_entered_lbp SET NOT NULL;

-- Goods receipt lines
ALTER TABLE goods_receipt_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_lbp numeric(18,2);

UPDATE goods_receipt_lines l
SET uom = COALESCE(NULLIF(l.uom, ''), i.unit_of_measure)
FROM goods_receipts gr, items i
WHERE gr.id = l.goods_receipt_id
  AND i.id = l.item_id
  AND gr.company_id = i.company_id
  AND (l.uom IS NULL OR l.uom = '');

UPDATE goods_receipt_lines
SET qty_entered = CASE
  WHEN COALESCE(qty_factor, 1) = 0 THEN qty
  ELSE qty / COALESCE(qty_factor, 1)
END
WHERE qty_entered IS NULL;

UPDATE goods_receipt_lines
SET unit_cost_entered_usd = COALESCE(unit_cost_entered_usd, unit_cost_usd * COALESCE(qty_factor, 1)),
    unit_cost_entered_lbp = COALESCE(unit_cost_entered_lbp, unit_cost_lbp * COALESCE(qty_factor, 1))
WHERE unit_cost_entered_usd IS NULL OR unit_cost_entered_lbp IS NULL;

ALTER TABLE goods_receipt_lines
  ALTER COLUMN qty_entered SET NOT NULL,
  ALTER COLUMN unit_cost_entered_usd SET NOT NULL,
  ALTER COLUMN unit_cost_entered_lbp SET NOT NULL;

-- Supplier invoice lines
ALTER TABLE supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_usd numeric(18,4),
  ADD COLUMN IF NOT EXISTS unit_cost_entered_lbp numeric(18,2);

UPDATE supplier_invoice_lines l
SET uom = COALESCE(NULLIF(l.uom, ''), i.unit_of_measure)
FROM supplier_invoices inv, items i
WHERE inv.id = l.supplier_invoice_id
  AND i.id = l.item_id
  AND inv.company_id = i.company_id
  AND (l.uom IS NULL OR l.uom = '');

UPDATE supplier_invoice_lines
SET qty_entered = CASE
  WHEN COALESCE(qty_factor, 1) = 0 THEN qty
  ELSE qty / COALESCE(qty_factor, 1)
END
WHERE qty_entered IS NULL;

UPDATE supplier_invoice_lines
SET unit_cost_entered_usd = COALESCE(unit_cost_entered_usd, unit_cost_usd * COALESCE(qty_factor, 1)),
    unit_cost_entered_lbp = COALESCE(unit_cost_entered_lbp, unit_cost_lbp * COALESCE(qty_factor, 1))
WHERE unit_cost_entered_usd IS NULL OR unit_cost_entered_lbp IS NULL;

ALTER TABLE supplier_invoice_lines
  ALTER COLUMN qty_entered SET NOT NULL,
  ALTER COLUMN unit_cost_entered_usd SET NOT NULL,
  ALTER COLUMN unit_cost_entered_lbp SET NOT NULL;

-- Stock transfer lines
ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,6);

UPDATE stock_transfer_lines l
SET uom = COALESCE(NULLIF(l.uom, ''), i.unit_of_measure)
FROM stock_transfers st, items i
WHERE st.id = l.stock_transfer_id
  AND i.id = l.item_id
  AND st.company_id = i.company_id
  AND (l.uom IS NULL OR l.uom = '');

UPDATE stock_transfer_lines
SET qty_entered = CASE
  WHEN COALESCE(qty_factor, 1) = 0 THEN qty
  ELSE qty / COALESCE(qty_factor, 1)
END
WHERE qty_entered IS NULL;

ALTER TABLE stock_transfer_lines
  ALTER COLUMN qty_entered SET NOT NULL;

COMMIT;
