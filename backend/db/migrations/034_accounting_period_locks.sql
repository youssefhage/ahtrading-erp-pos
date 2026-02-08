-- Accounting period locks (close periods; block new journals).

CREATE TABLE IF NOT EXISTS accounting_period_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  locked boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_accounting_period_locks_company_dates
  ON accounting_period_locks (company_id, start_date, end_date);

ALTER TABLE accounting_period_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_period_locks_isolation
  ON accounting_period_locks USING (company_id = app_current_company_id());

CREATE OR REPLACE FUNCTION gl_journals_prevent_locked_period()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM accounting_period_locks l
    WHERE l.company_id = NEW.company_id
      AND l.locked = true
      AND NEW.journal_date BETWEEN l.start_date AND l.end_date
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'accounting period locked for %', NEW.journal_date
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gl_journals_period_lock ON gl_journals;
CREATE TRIGGER trg_gl_journals_period_lock
BEFORE INSERT ON gl_journals
FOR EACH ROW
EXECUTE FUNCTION gl_journals_prevent_locked_period();

