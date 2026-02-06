-- Add missing operational metadata and server-side doc numbers (v1 usability).

-- Purchase order numbering
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS order_no text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_order_no
  ON purchase_orders (company_id, order_no)
  WHERE order_no IS NOT NULL;

-- Goods receipt numbering + warehouse context
ALTER TABLE goods_receipts
  ADD COLUMN IF NOT EXISTS receipt_no text,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_goods_receipts_receipt_no
  ON goods_receipts (company_id, receipt_no)
  WHERE receipt_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goods_receipts_warehouse
  ON goods_receipts (company_id, warehouse_id);

-- Sales return numbering + POS context
ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS return_no text,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES pos_devices(id),
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES pos_shifts(id),
  ADD COLUMN IF NOT EXISTS refund_method text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_returns_return_no
  ON sales_returns (company_id, return_no)
  WHERE return_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_returns_warehouse
  ON sales_returns (company_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_sales_returns_device
  ON sales_returns (company_id, device_id);

