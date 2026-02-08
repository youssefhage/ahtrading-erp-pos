-- AI demand forecasts (simple but durable): keep last computed forecast per item.

CREATE TABLE IF NOT EXISTS ai_demand_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id),

  method text NOT NULL DEFAULT 'ema',
  window_days integer NOT NULL DEFAULT 28,
  horizon_days integer NOT NULL DEFAULT 14,

  avg_daily_qty numeric(18,6) NOT NULL DEFAULT 0,
  forecast_qty numeric(18,6) NOT NULL DEFAULT 0,

  details jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, item_id, method)
);

CREATE INDEX IF NOT EXISTS idx_ai_demand_forecasts_company
  ON ai_demand_forecasts(company_id, computed_at DESC);

ALTER TABLE ai_demand_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_demand_forecasts_isolation ON ai_demand_forecasts;
CREATE POLICY ai_demand_forecasts_isolation
  ON ai_demand_forecasts USING (company_id = app_current_company_id());

