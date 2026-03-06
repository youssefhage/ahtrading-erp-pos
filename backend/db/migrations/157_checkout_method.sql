-- 157: Add checkout_method to sales_invoices
-- Tracks how the sale was checked out: 'cash', 'credit', 'delivery', etc.
-- Distinct from payment method — this records the POS checkout flow used.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS checkout_method text;
