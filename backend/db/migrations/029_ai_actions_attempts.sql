-- Improve AI action robustness: attempts + error tracking.

ALTER TABLE ai_actions
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_ai_actions_company_status_updated
  ON ai_actions (company_id, status, updated_at DESC);

