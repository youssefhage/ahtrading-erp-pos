-- AI governance: explicit approval/queue/audit metadata.

ALTER TABLE ai_actions
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS queued_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_by_user_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_ai_actions_company_status_queued
  ON ai_actions(company_id, status, queued_at DESC);

