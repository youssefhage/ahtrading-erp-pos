-- POS cashiers (offline-capable PIN login for POS devices).

CREATE TABLE IF NOT EXISTS pos_cashiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  pin_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_cashiers_company ON pos_cashiers(company_id);

ALTER TABLE pos_cashiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_cashiers_isolation ON pos_cashiers;
CREATE POLICY pos_cashiers_isolation
  ON pos_cashiers USING (company_id = app_current_company_id());

-- Reuse generic trigger from 022_catalog_timestamps.sql if present.
DROP TRIGGER IF EXISTS trg_pos_cashiers_updated_at ON pos_cashiers;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_pos_cashiers_updated_at
      BEFORE UPDATE ON pos_cashiers
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

ALTER TABLE pos_shifts
  ADD COLUMN IF NOT EXISTS opened_cashier_id uuid REFERENCES pos_cashiers(id),
  ADD COLUMN IF NOT EXISTS closed_cashier_id uuid REFERENCES pos_cashiers(id);

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES pos_cashiers(id);

ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES pos_cashiers(id);

ALTER TABLE pos_cash_movements
  ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES pos_cashiers(id);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_cashier ON sales_invoices(company_id, cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_cashier ON sales_returns(company_id, cashier_id);
CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_cashier ON pos_cash_movements(company_id, cashier_id);

