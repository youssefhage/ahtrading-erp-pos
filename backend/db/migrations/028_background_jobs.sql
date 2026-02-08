-- Background job schedules and run logs (AI + maintenance)

CREATE TABLE IF NOT EXISTS background_job_schedules (
  company_id uuid NOT NULL REFERENCES companies(id),
  job_code text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  interval_seconds integer NOT NULL DEFAULT 3600,
  options_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, job_code)
);

CREATE TABLE IF NOT EXISTS background_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  job_code text NOT NULL,
  status text NOT NULL DEFAULT 'running', -- running|success|failed
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_message text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_background_job_runs_company_job_time
  ON background_job_runs (company_id, job_code, started_at DESC);

ALTER TABLE background_job_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY background_job_schedules_isolation
  ON background_job_schedules USING (company_id = app_current_company_id());

CREATE POLICY background_job_runs_isolation
  ON background_job_runs USING (company_id = app_current_company_id());

-- AI actions: prevent duplicate actions per recommendation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_actions_unique_recommendation
  ON ai_actions (company_id, recommendation_id)
  WHERE recommendation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_actions_company_status_created
  ON ai_actions (company_id, status, created_at DESC);

