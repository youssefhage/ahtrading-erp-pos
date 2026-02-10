-- Edge -> Cloud replication outbox (phase 1).
-- Stores "documents to replicate" from a store edge node to the cloud system.
--
-- Design:
-- - Idempotent enqueue via UNIQUE(company_id, entity_type, entity_id)
-- - Worker claims rows with SKIP LOCKED and marks them sent/failed.

BEGIN;

CREATE TABLE IF NOT EXISTS edge_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  entity_type text NOT NULL, -- e.g. 'sales_invoice'
  entity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending|sent|failed
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_sync_outbox_company_status
  ON edge_sync_outbox(company_id, status, created_at ASC);

ALTER TABLE edge_sync_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS edge_sync_outbox_isolation ON edge_sync_outbox;
CREATE POLICY edge_sync_outbox_isolation
  ON edge_sync_outbox USING (company_id = app_current_company_id());

-- Reuse the shared trigger function defined in 022_catalog_timestamps.sql.
DROP TRIGGER IF EXISTS trg_edge_sync_outbox_updated_at ON edge_sync_outbox;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_edge_sync_outbox_updated_at
      BEFORE UPDATE ON edge_sync_outbox
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

COMMIT;

