-- AI agent pipeline tables

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  event_type text NOT NULL,
  source_type text,
  source_id uuid,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  agent_code text NOT NULL,
  event_id uuid REFERENCES events(id),
  recommendation_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  agent_code text NOT NULL,
  recommendation_id uuid REFERENCES ai_recommendations(id),
  action_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_isolation ON events USING (company_id = app_current_company_id());
CREATE POLICY ai_recommendations_isolation ON ai_recommendations USING (company_id = app_current_company_id());
CREATE POLICY ai_actions_isolation ON ai_actions USING (company_id = app_current_company_id());
