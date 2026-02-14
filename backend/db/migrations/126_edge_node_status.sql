-- Edge node heartbeat/status (cloud visibility).
-- Tracks last_seen timestamps per (company_id, node_id) so Admin can show
-- whether an on-prem edge node is currently online.

BEGIN;

CREATE TABLE IF NOT EXISTS edge_node_status (
  company_id uuid NOT NULL REFERENCES companies(id),
  node_id text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_ping_at timestamptz,
  last_import_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_node_status_company_last_seen
  ON edge_node_status(company_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_edge_node_status_company_last_import
  ON edge_node_status(company_id, last_import_at DESC);

ALTER TABLE edge_node_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS edge_node_status_isolation ON edge_node_status;
CREATE POLICY edge_node_status_isolation
  ON edge_node_status USING (company_id = app_current_company_id());

-- Reuse the shared trigger function defined in 022_catalog_timestamps.sql.
DROP TRIGGER IF EXISTS trg_edge_node_status_updated_at ON edge_node_status;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_edge_node_status_updated_at
      BEFORE UPDATE ON edge_node_status
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

COMMIT;

