-- Add traceability metadata to stock moves (who/why/line-level source),
-- and introduce a structured reason catalog.

BEGIN;

CREATE TABLE IF NOT EXISTS stock_move_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_stock_move_reasons_company
  ON stock_move_reasons(company_id, is_active, code);

ALTER TABLE stock_move_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_move_reasons_isolation ON stock_move_reasons;
CREATE POLICY stock_move_reasons_isolation
  ON stock_move_reasons USING (company_id = app_current_company_id());

DROP TRIGGER IF EXISTS trg_stock_move_reasons_updated_at ON stock_move_reasons;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $sql$
      CREATE TRIGGER trg_stock_move_reasons_updated_at
      BEFORE UPDATE ON stock_move_reasons
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    $sql$;
  END IF;
END;
$$;

ALTER TABLE stock_moves
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_by_device_id uuid REFERENCES pos_devices(id),
  ADD COLUMN IF NOT EXISTS created_by_cashier_id uuid REFERENCES pos_cashiers(id),
  ADD COLUMN IF NOT EXISTS reason_id uuid REFERENCES stock_move_reasons(id),
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS source_line_type text,
  ADD COLUMN IF NOT EXISTS source_line_id uuid;

CREATE INDEX IF NOT EXISTS idx_stock_moves_company_created_by_user
  ON stock_moves(company_id, created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_moves_company_source_line
  ON stock_moves(company_id, source_line_type, source_line_id)
  WHERE source_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_moves_company_reason_id
  ON stock_moves(company_id, reason_id)
  WHERE reason_id IS NOT NULL;

COMMIT;

