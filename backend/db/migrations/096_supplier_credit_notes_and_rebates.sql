-- Supplier credit notes (vendor rebates/credits) + per-batch rebate tracking (v1).
-- - Credit notes are first-class purchasing documents with GL posting.
-- - Credit notes can optionally allocate credits across a posted goods receipt to track per-batch cost impact.
-- - Credits can be applied to posted supplier invoices to reduce AP aging balances (no cash movement).

BEGIN;

-- Per-line rebate totals (for reporting / cost-layer traceability).
ALTER TABLE goods_receipt_lines
  ADD COLUMN IF NOT EXISTS rebate_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rebate_total_lbp numeric(18,2) NOT NULL DEFAULT 0;

ALTER TABLE batch_cost_layers
  ADD COLUMN IF NOT EXISTS rebate_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rebate_total_lbp numeric(18,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS supplier_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  credit_no text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  kind text NOT NULL DEFAULT 'expense', -- 'expense' | 'receipt'
  goods_receipt_id uuid REFERENCES goods_receipts(id),
  credit_date date NOT NULL DEFAULT CURRENT_DATE,
  rate_type rate_type NOT NULL DEFAULT 'market',
  exchange_rate numeric(18,6) NOT NULL DEFAULT 0,
  memo text,
  total_usd numeric(18,4) NOT NULL DEFAULT 0,
  total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES users(id),
  posted_by_user_id uuid REFERENCES users(id),
  posted_at timestamptz,
  canceled_by_user_id uuid REFERENCES users(id),
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, credit_no)
);

ALTER TABLE supplier_credit_notes
  DROP CONSTRAINT IF EXISTS supplier_credit_notes_status_check;
ALTER TABLE supplier_credit_notes
  ADD CONSTRAINT supplier_credit_notes_status_check
  CHECK (status IN ('draft', 'posted', 'canceled'));

ALTER TABLE supplier_credit_notes
  DROP CONSTRAINT IF EXISTS supplier_credit_notes_kind_check;
ALTER TABLE supplier_credit_notes
  ADD CONSTRAINT supplier_credit_notes_kind_check
  CHECK (kind IN ('expense', 'receipt'));

CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_company_created
  ON supplier_credit_notes(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_company_status
  ON supplier_credit_notes(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_company_supplier
  ON supplier_credit_notes(company_id, supplier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_credit_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  supplier_credit_note_id uuid NOT NULL REFERENCES supplier_credit_notes(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  description text,
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, supplier_credit_note_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_note_lines_company_doc
  ON supplier_credit_note_lines(company_id, supplier_credit_note_id, line_no);

CREATE TABLE IF NOT EXISTS supplier_credit_note_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  supplier_credit_note_id uuid NOT NULL REFERENCES supplier_credit_notes(id) ON DELETE CASCADE,
  goods_receipt_line_id uuid NOT NULL REFERENCES goods_receipt_lines(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES batches(id),
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, supplier_credit_note_id, goods_receipt_line_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_alloc_company_doc
  ON supplier_credit_note_allocations(company_id, supplier_credit_note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_credit_alloc_company_gr_line
  ON supplier_credit_note_allocations(company_id, goods_receipt_line_id);

CREATE TABLE IF NOT EXISTS supplier_credit_note_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  supplier_credit_note_id uuid NOT NULL REFERENCES supplier_credit_notes(id) ON DELETE CASCADE,
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_apps_company_credit
  ON supplier_credit_note_applications(company_id, supplier_credit_note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_credit_apps_company_invoice
  ON supplier_credit_note_applications(company_id, supplier_invoice_id, created_at DESC);

ALTER TABLE supplier_credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_credit_note_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_credit_note_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_credit_notes_isolation ON supplier_credit_notes;
CREATE POLICY supplier_credit_notes_isolation
  ON supplier_credit_notes USING (company_id = app_current_company_id());

DROP POLICY IF EXISTS supplier_credit_note_lines_isolation ON supplier_credit_note_lines;
CREATE POLICY supplier_credit_note_lines_isolation
  ON supplier_credit_note_lines USING (company_id = app_current_company_id());

DROP POLICY IF EXISTS supplier_credit_note_allocations_isolation ON supplier_credit_note_allocations;
CREATE POLICY supplier_credit_note_allocations_isolation
  ON supplier_credit_note_allocations USING (company_id = app_current_company_id());

DROP POLICY IF EXISTS supplier_credit_note_applications_isolation ON supplier_credit_note_applications;
CREATE POLICY supplier_credit_note_applications_isolation
  ON supplier_credit_note_applications USING (company_id = app_current_company_id());

COMMIT;
