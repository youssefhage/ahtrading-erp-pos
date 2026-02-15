-- Local (edge) state for Cloud -> Edge master data replication cursors.

BEGIN;

CREATE TABLE IF NOT EXISTS edge_masterdata_sync_state (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity text NOT NULL,
  cursor_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, entity)
);

CREATE INDEX IF NOT EXISTS idx_edge_masterdata_sync_state_company
  ON edge_masterdata_sync_state(company_id);

ALTER TABLE edge_masterdata_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS edge_masterdata_sync_state_isolation ON edge_masterdata_sync_state;
CREATE POLICY edge_masterdata_sync_state_isolation
  ON edge_masterdata_sync_state USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_edge_masterdata_sync_state_updated_at ON edge_masterdata_sync_state;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_edge_masterdata_sync_state_updated_at
      BEFORE UPDATE ON edge_masterdata_sync_state
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

COMMIT;

