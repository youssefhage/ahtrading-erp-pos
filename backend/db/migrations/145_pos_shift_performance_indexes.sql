-- Shift performance indexes:
-- - Faster open-shift lookup per device/company.
-- - Faster expected-cash aggregation (payments/refunds/movements).
-- - Faster variance alert/report queries on recently closed shifts.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_pos_shifts_company_device_status_opened
  ON pos_shifts(company_id, device_id, status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_shifts_company_status_closed
  ON pos_shifts(company_id, status, closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_company_shift
  ON pos_cash_movements(company_id, shift_id);

CREATE INDEX IF NOT EXISTS idx_sales_payments_invoice_method_lc_not_voided
  ON sales_payments(invoice_id, lower(method))
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_returns_company_shift_status
  ON sales_returns(company_id, shift_id, status);

CREATE INDEX IF NOT EXISTS idx_sales_returns_company_device_created_status
  ON sales_returns(company_id, device_id, created_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_sales_refunds_return_method_lc
  ON sales_refunds(sales_return_id, lower(method));

COMMIT;
