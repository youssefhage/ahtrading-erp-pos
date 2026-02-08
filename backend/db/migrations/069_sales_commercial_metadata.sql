-- Add common commercial metadata needed for real POS/ERP operations:
-- discounts, applied pricing context, payment references, and line-level UOM/pack info.

BEGIN;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS subtotal_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_lbp numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total_lbp numeric(18,2) NOT NULL DEFAULT 0;

ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS uom text,
  ADD COLUMN IF NOT EXISTS qty_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pre_discount_unit_price_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pre_discount_unit_price_lbp numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_pct numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_promotion_id uuid REFERENCES promotions(id),
  ADD COLUMN IF NOT EXISTS applied_promotion_item_id uuid REFERENCES promotion_items(id),
  ADD COLUMN IF NOT EXISTS applied_price_list_id uuid REFERENCES price_lists(id);

ALTER TABLE sales_payments
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS auth_code text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS settlement_currency currency_code,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz;

ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS auth_code text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS settlement_currency currency_code,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz;

COMMIT;

