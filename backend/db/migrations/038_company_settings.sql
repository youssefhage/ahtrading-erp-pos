-- Company settings (lightweight, typed-by-convention JSON values).

CREATE TABLE IF NOT EXISTS company_settings (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  value_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

CREATE INDEX IF NOT EXISTS idx_company_settings_company ON company_settings(company_id);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_settings_isolation ON company_settings;
CREATE POLICY company_settings_isolation
  ON company_settings USING (company_id = app_current_company_id());

