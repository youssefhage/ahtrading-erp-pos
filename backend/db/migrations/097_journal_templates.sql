-- Journal templates (recurring journals foundation) (v1).
-- Stores fixed-amount templates that can be instantiated into manual journals.

BEGIN;

CREATE TABLE IF NOT EXISTS journal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  memo text,
  default_rate_type rate_type NOT NULL DEFAULT 'market',
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_templates_company_created
  ON journal_templates(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS journal_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  journal_template_id uuid NOT NULL REFERENCES journal_templates(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  account_id uuid NOT NULL REFERENCES company_coa_accounts(id),
  side text NOT NULL, -- debit|credit
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  memo text,
  cost_center_id uuid REFERENCES cost_centers(id),
  project_id uuid REFERENCES projects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, journal_template_id, line_no)
);

ALTER TABLE journal_template_lines
  DROP CONSTRAINT IF EXISTS journal_template_lines_side_check;
ALTER TABLE journal_template_lines
  ADD CONSTRAINT journal_template_lines_side_check
  CHECK (side IN ('debit', 'credit'));

CREATE INDEX IF NOT EXISTS idx_journal_template_lines_company_tpl
  ON journal_template_lines(company_id, journal_template_id, line_no);

ALTER TABLE journal_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_template_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journal_templates_isolation ON journal_templates;
CREATE POLICY journal_templates_isolation
  ON journal_templates USING (company_id = app_current_company_id());

DROP POLICY IF EXISTS journal_template_lines_isolation ON journal_template_lines;
CREATE POLICY journal_template_lines_isolation
  ON journal_template_lines USING (company_id = app_current_company_id());

COMMIT;
