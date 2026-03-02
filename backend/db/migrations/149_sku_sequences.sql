-- Auto-generated SKU sequences per prefix per company
CREATE TABLE IF NOT EXISTS sku_sequences (
  company_id uuid NOT NULL REFERENCES companies(id),
  prefix     text NOT NULL,
  next_no    bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, prefix)
);

ALTER TABLE sku_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY sku_sequences_isolation
  ON sku_sequences USING (company_id = app_current_company_id());

-- Atomically get-and-increment; auto-creates row if prefix is new
CREATE OR REPLACE FUNCTION next_sku_no(
  p_company_id uuid,
  p_prefix     text,
  p_padding    integer DEFAULT 3
) RETURNS text AS $$
DECLARE
  v_next bigint;
BEGIN
  INSERT INTO sku_sequences (company_id, prefix, next_no)
  VALUES (p_company_id, p_prefix, 1)
  ON CONFLICT (company_id, prefix) DO NOTHING;

  SELECT next_no INTO v_next
  FROM sku_sequences
  WHERE company_id = p_company_id AND prefix = p_prefix
  FOR UPDATE;

  UPDATE sku_sequences
  SET next_no = v_next + 1
  WHERE company_id = p_company_id AND prefix = p_prefix;

  RETURN p_prefix || '-' || lpad(v_next::text, p_padding, '0');
END;
$$ LANGUAGE plpgsql;
