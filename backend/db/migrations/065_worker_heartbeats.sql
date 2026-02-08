-- Worker heartbeat per company, so Admin can surface "worker is alive" without log access.

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_name text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (company_id, worker_name)
);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_company_last_seen
ON worker_heartbeats(company_id, last_seen_at DESC);

ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_heartbeats_isolation ON worker_heartbeats
USING (company_id = app_current_company_id());

