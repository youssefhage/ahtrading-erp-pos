-- Prevent duplicate recommendations per event/agent

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_recommendations_event_agent
  ON ai_recommendations (company_id, agent_code, event_id)
  WHERE event_id IS NOT NULL;
