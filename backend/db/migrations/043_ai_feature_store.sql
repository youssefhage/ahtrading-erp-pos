-- AI feature store: daily item sales aggregates for forecasting/anomaly detection.

CREATE TABLE IF NOT EXISTS ai_item_sales_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id),
  sale_date date NOT NULL,

  sold_qty numeric(18,4) NOT NULL DEFAULT 0,
  sold_revenue_usd numeric(18,4) NOT NULL DEFAULT 0,
  sold_revenue_lbp numeric(18,2) NOT NULL DEFAULT 0,

  returned_qty numeric(18,4) NOT NULL DEFAULT 0,
  returned_revenue_usd numeric(18,4) NOT NULL DEFAULT 0,
  returned_revenue_lbp numeric(18,2) NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, item_id, sale_date)
);

CREATE INDEX IF NOT EXISTS idx_ai_item_sales_daily_company_date
  ON ai_item_sales_daily(company_id, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_ai_item_sales_daily_item_date
  ON ai_item_sales_daily(company_id, item_id, sale_date DESC);

ALTER TABLE ai_item_sales_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_item_sales_daily_isolation ON ai_item_sales_daily;
CREATE POLICY ai_item_sales_daily_isolation
  ON ai_item_sales_daily USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_ai_item_sales_daily_updated_at ON ai_item_sales_daily;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_ai_item_sales_daily_updated_at
      BEFORE UPDATE ON ai_item_sales_daily
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

