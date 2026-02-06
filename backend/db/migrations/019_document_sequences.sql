-- Document numbering sequences (server-side authoritative numbers)

CREATE TABLE IF NOT EXISTS document_sequences (
  company_id uuid NOT NULL REFERENCES companies(id),
  doc_type text NOT NULL,
  prefix text NOT NULL,
  next_no bigint NOT NULL DEFAULT 1,
  padding integer NOT NULL DEFAULT 6,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, doc_type)
);

ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_sequences_isolation
  ON document_sequences USING (company_id = app_current_company_id());

CREATE OR REPLACE FUNCTION next_document_no(p_company_id uuid, p_doc_type text)
RETURNS text AS $$
DECLARE
  v_next bigint;
  v_padding integer;
  v_prefix text;
  v_year text;
BEGIN
  v_year := to_char(current_date, 'YYYY');

  INSERT INTO document_sequences (company_id, doc_type, prefix, next_no)
  VALUES (p_company_id, p_doc_type, upper(p_doc_type), 1)
  ON CONFLICT (company_id, doc_type) DO NOTHING;

  SELECT next_no, padding, prefix
    INTO v_next, v_padding, v_prefix
  FROM document_sequences
  WHERE company_id = p_company_id AND doc_type = p_doc_type
  FOR UPDATE;

  UPDATE document_sequences
  SET next_no = v_next + 1,
      updated_at = now()
  WHERE company_id = p_company_id AND doc_type = p_doc_type;

  RETURN v_prefix || '-' || v_year || '-' || lpad(v_next::text, v_padding, '0');
END;
$$ LANGUAGE plpgsql;

