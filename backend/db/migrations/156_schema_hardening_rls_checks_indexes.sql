-- Schema hardening: fix missing RLS, CHECK constraints, and FK indexes
-- found during code audit.
--
-- Fixes:
--   1. CRITICAL  - unit_of_measures table missing RLS (tenant data isolation breach)
--   2. HIGH      - Missing CHECK constraints on exchange_rate columns (must be > 0)
--   3. HIGH      - Missing CHECK constraints on stock_moves qty (qty_in/qty_out >= 0)
--   4. HIGH      - Missing CHECK constraint on exchange_rates.usd_to_lbp (must be > 0)
--   5. MEDIUM    - Missing indexes on commonly-queried foreign keys

BEGIN;

-- ============================================================================
-- 1. CRITICAL: Enable RLS on unit_of_measures
-- ============================================================================
-- Every other company-scoped table has RLS. unit_of_measures was added in
-- migration 104 but RLS was never enabled, creating a tenant isolation gap.

ALTER TABLE unit_of_measures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unit_of_measures_isolation ON unit_of_measures;
CREATE POLICY unit_of_measures_isolation
  ON unit_of_measures
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

-- Also add RLS to item_uom_conversions (added in 108, has company_id,
-- RLS was enabled but the policy only uses USING; add WITH CHECK for writes).
DROP POLICY IF EXISTS item_uom_conversions_isolation ON item_uom_conversions;
CREATE POLICY item_uom_conversions_isolation
  ON item_uom_conversions
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());


-- ============================================================================
-- 2. CHECK constraints: exchange_rate > 0
-- ============================================================================
-- Tables created in 001_init with exchange_rate NOT NULL (no default 0),
-- so existing data already satisfies > 0.

ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS chk_sales_orders_exchange_rate;
ALTER TABLE sales_orders
  ADD CONSTRAINT chk_sales_orders_exchange_rate
  CHECK (exchange_rate > 0);

ALTER TABLE sales_invoices
  DROP CONSTRAINT IF EXISTS chk_sales_invoices_exchange_rate;
ALTER TABLE sales_invoices
  ADD CONSTRAINT chk_sales_invoices_exchange_rate
  CHECK (exchange_rate > 0);

ALTER TABLE sales_returns
  DROP CONSTRAINT IF EXISTS chk_sales_returns_exchange_rate;
ALTER TABLE sales_returns
  ADD CONSTRAINT chk_sales_returns_exchange_rate
  CHECK (exchange_rate > 0);

ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_exchange_rate;
ALTER TABLE purchase_orders
  ADD CONSTRAINT chk_purchase_orders_exchange_rate
  CHECK (exchange_rate > 0);

ALTER TABLE goods_receipts
  DROP CONSTRAINT IF EXISTS chk_goods_receipts_exchange_rate;
ALTER TABLE goods_receipts
  ADD CONSTRAINT chk_goods_receipts_exchange_rate
  CHECK (exchange_rate > 0);

ALTER TABLE supplier_invoices
  DROP CONSTRAINT IF EXISTS chk_supplier_invoices_exchange_rate;
ALTER TABLE supplier_invoices
  ADD CONSTRAINT chk_supplier_invoices_exchange_rate
  CHECK (exchange_rate > 0);

ALTER TABLE intercompany_settlements
  DROP CONSTRAINT IF EXISTS chk_intercompany_settlements_exchange_rate;
ALTER TABLE intercompany_settlements
  ADD CONSTRAINT chk_intercompany_settlements_exchange_rate
  CHECK (exchange_rate > 0);

-- exchange_rates.usd_to_lbp must always be positive.
ALTER TABLE exchange_rates
  DROP CONSTRAINT IF EXISTS chk_exchange_rates_usd_to_lbp;
ALTER TABLE exchange_rates
  ADD CONSTRAINT chk_exchange_rates_usd_to_lbp
  CHECK (usd_to_lbp > 0);

-- gl_journals.exchange_rate was added in 032 with DEFAULT 0, so existing rows
-- may have 0. Use >= 0 to avoid breaking existing data.
ALTER TABLE gl_journals
  DROP CONSTRAINT IF EXISTS chk_gl_journals_exchange_rate;
ALTER TABLE gl_journals
  ADD CONSTRAINT chk_gl_journals_exchange_rate
  CHECK (exchange_rate >= 0);

-- landed_costs.exchange_rate defaults to 0 (draft docs may have 0).
ALTER TABLE landed_costs
  DROP CONSTRAINT IF EXISTS chk_landed_costs_exchange_rate;
ALTER TABLE landed_costs
  ADD CONSTRAINT chk_landed_costs_exchange_rate
  CHECK (exchange_rate >= 0);

-- supplier_credit_notes.exchange_rate defaults to 0 (draft docs may have 0).
ALTER TABLE supplier_credit_notes
  DROP CONSTRAINT IF EXISTS chk_supplier_credit_notes_exchange_rate;
ALTER TABLE supplier_credit_notes
  ADD CONSTRAINT chk_supplier_credit_notes_exchange_rate
  CHECK (exchange_rate >= 0);


-- ============================================================================
-- 3. CHECK constraints: stock_moves qty_in / qty_out >= 0
-- ============================================================================
-- Stock moves record inbound/outbound separately; both must be non-negative.

ALTER TABLE stock_moves
  DROP CONSTRAINT IF EXISTS chk_stock_moves_qty_in;
ALTER TABLE stock_moves
  ADD CONSTRAINT chk_stock_moves_qty_in
  CHECK (qty_in >= 0);

ALTER TABLE stock_moves
  DROP CONSTRAINT IF EXISTS chk_stock_moves_qty_out;
ALTER TABLE stock_moves
  ADD CONSTRAINT chk_stock_moves_qty_out
  CHECK (qty_out >= 0);


-- ============================================================================
-- 4. Missing indexes on foreign keys for common query patterns
-- ============================================================================

-- customers(company_id) - base listing FK; no bare company_id index exists.
CREATE INDEX IF NOT EXISTS idx_customers_company
  ON customers(company_id);

-- suppliers(company_id) - base listing FK.
CREATE INDEX IF NOT EXISTS idx_suppliers_company
  ON suppliers(company_id);

-- goods_receipts(company_id) - listing / RLS scans.
CREATE INDEX IF NOT EXISTS idx_goods_receipts_company
  ON goods_receipts(company_id);

-- sales_returns(company_id) - listing / RLS scans.
CREATE INDEX IF NOT EXISTS idx_sales_returns_company
  ON sales_returns(company_id);

-- batches(company_id) - listing / RLS scans.
CREATE INDEX IF NOT EXISTS idx_batches_company
  ON batches(company_id);

-- sales_orders(company_id) - listing / RLS scans.
CREATE INDEX IF NOT EXISTS idx_sales_orders_company
  ON sales_orders(company_id);

-- item_prices(item_id) - price lookups by item (very common query).
CREATE INDEX IF NOT EXISTS idx_item_prices_item
  ON item_prices(item_id);

-- sales_invoice_lines(item_id) - item sales history, reporting.
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_item
  ON sales_invoice_lines(item_id);

-- purchase_order_lines(item_id) - item purchase history.
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_item
  ON purchase_order_lines(item_id);

-- purchase_orders(supplier_id) - filter POs by supplier.
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier
  ON purchase_orders(company_id, supplier_id);

-- goods_receipts(supplier_id) - filter GRs by supplier.
CREATE INDEX IF NOT EXISTS idx_goods_receipts_supplier
  ON goods_receipts(company_id, supplier_id);

-- supplier_invoices(supplier_id) - filter invoices by supplier.
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier
  ON supplier_invoices(company_id, supplier_id);

-- auth_mfa_challenges(user_id) - MFA challenge lookups during login.
CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_user
  ON auth_mfa_challenges(user_id);

COMMIT;
