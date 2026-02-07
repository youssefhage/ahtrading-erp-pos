-- Auth sessions: store an active company context per session.

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS active_company_id uuid REFERENCES companies(id);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_company
  ON auth_sessions(active_company_id);

