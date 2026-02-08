-- Structured return reasons and basic condition flags for returns/refunds.

BEGIN;

CREATE TABLE IF NOT EXISTS sales_return_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sales_return_reasons_company
  ON sales_return_reasons(company_id, is_active, code);

ALTER TABLE sales_return_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_return_reasons_isolation ON sales_return_reasons;
CREATE POLICY sales_return_reasons_isolation
  ON sales_return_reasons USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_sales_return_reasons_updated_at ON sales_return_reasons;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_sales_return_reasons_updated_at
      BEFORE UPDATE ON sales_return_reasons
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS reason_id uuid REFERENCES sales_return_reasons(id),
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS return_condition text;

ALTER TABLE sales_return_lines
  ADD COLUMN IF NOT EXISTS reason_id uuid REFERENCES sales_return_reasons(id),
  ADD COLUMN IF NOT EXISTS line_condition text;

CREATE INDEX IF NOT EXISTS idx_sales_returns_company_reason
  ON sales_returns(company_id, reason_id)
  WHERE reason_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_return_lines_reason
  ON sales_return_lines(reason_id)
  WHERE reason_id IS NOT NULL;

COMMIT;

