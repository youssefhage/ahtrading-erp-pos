-- POS cash movements (cash in/out, paid-outs, safe drops) per shift

CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  shift_id uuid NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
  movement_type text NOT NULL, -- cash_in|cash_out|paid_out|safe_drop|other
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_company ON pos_cash_movements(company_id);
CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_shift ON pos_cash_movements(shift_id);

ALTER TABLE pos_cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY pos_cash_movements_isolation
  ON pos_cash_movements USING (company_id = app_current_company_id());

