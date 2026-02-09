-- Recurring journals (Accounting v2 control): schedule journal creation from templates.

BEGIN;

CREATE TABLE IF NOT EXISTS recurring_journal_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  journal_template_id uuid NOT NULL REFERENCES journal_templates(id),
  cadence text NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  -- For weekly cadence: 1=Mon .. 7=Sun (ISO).
  day_of_week int CHECK (day_of_week BETWEEN 1 AND 7),
  -- For monthly cadence: 1..31 (execution clamps to month length).
  day_of_month int CHECK (day_of_month BETWEEN 1 AND 31),
  next_run_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_journal_rules_company_next
  ON recurring_journal_rules(company_id, next_run_date, is_active);

-- Expression uniqueness: prevents duplicate cadence entries for the same template.
-- (We use an index because UNIQUE table constraints don't support expression columns.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_recurring_journal_rules_identity
  ON recurring_journal_rules(company_id, journal_template_id, cadence, COALESCE(day_of_week, 0), COALESCE(day_of_month, 0));

ALTER TABLE recurring_journal_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recurring_journal_rules_isolation ON recurring_journal_rules;
CREATE POLICY recurring_journal_rules_isolation
  ON recurring_journal_rules USING (company_id = app_current_company_id());

COMMIT;
