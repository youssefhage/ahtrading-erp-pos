-- AI auto-execute settings

CREATE TABLE IF NOT EXISTS ai_agent_settings (
  company_id uuid NOT NULL REFERENCES companies(id),
  agent_code text NOT NULL,
  auto_execute boolean NOT NULL DEFAULT false,
  max_amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  max_actions_per_day integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, agent_code)
);

ALTER TABLE ai_agent_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_agent_settings_isolation
  ON ai_agent_settings USING (company_id = app_current_company_id());
