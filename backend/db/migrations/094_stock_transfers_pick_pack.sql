-- Stock transfers (document-first) with pick/pack allocations (v1)

BEGIN;

CREATE TABLE IF NOT EXISTS stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  transfer_no text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  from_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  to_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  from_location_id uuid REFERENCES warehouse_locations(id),
  to_location_id uuid REFERENCES warehouse_locations(id),
  memo text,
  transfer_date date,
  created_by_user_id uuid REFERENCES users(id),
  picked_by_user_id uuid REFERENCES users(id),
  picked_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  posted_at timestamptz,
  canceled_by_user_id uuid REFERENCES users(id),
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, transfer_no)
);

-- Keep statuses simple for v1; more states can be added later.
ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_status_check;
ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_status_check
  CHECK (status IN ('draft', 'picked', 'posted', 'canceled'));

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  stock_transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  item_id uuid NOT NULL REFERENCES items(id),
  qty numeric(18,4) NOT NULL,
  picked_qty numeric(18,4) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, stock_transfer_id, line_no)
);

CREATE TABLE IF NOT EXISTS stock_transfer_line_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  stock_transfer_line_id uuid NOT NULL REFERENCES stock_transfer_lines(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES batches(id),
  qty numeric(18,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_company_created
  ON stock_transfers(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_company_status
  ON stock_transfers(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_company_transfer
  ON stock_transfer_lines(company_id, stock_transfer_id, line_no);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_alloc_company_line
  ON stock_transfer_line_allocations(company_id, stock_transfer_line_id);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_line_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_transfers_isolation ON stock_transfers;
CREATE POLICY stock_transfers_isolation
  ON stock_transfers USING (company_id = app_current_company_id());

DROP POLICY IF EXISTS stock_transfer_lines_isolation ON stock_transfer_lines;
CREATE POLICY stock_transfer_lines_isolation
  ON stock_transfer_lines USING (company_id = app_current_company_id());

DROP POLICY IF EXISTS stock_transfer_line_allocations_isolation ON stock_transfer_line_allocations;
CREATE POLICY stock_transfer_line_allocations_isolation
  ON stock_transfer_line_allocations USING (company_id = app_current_company_id());

COMMIT;

