-- COA helper functions

CREATE OR REPLACE FUNCTION map_normal_balance(raw text) RETURNS normal_balance AS $$
  SELECT CASE trim(raw)
    WHEN 'C' THEN 'credit'::normal_balance
    WHEN 'D' THEN 'debit'::normal_balance
    WHEN 'C/D' THEN 'both'::normal_balance
    ELSE 'none'::normal_balance
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION clone_coa_template_to_company(
  p_company_id uuid,
  p_template_code text,
  p_effective_from date
) RETURNS uuid AS $$
DECLARE
  v_template_id uuid;
  v_version_id uuid;
  v_version_no int;
BEGIN
  SELECT id INTO v_template_id FROM coa_templates WHERE code = p_template_code;
  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'COA template % not found', p_template_code;
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_version_no
  FROM company_coa_versions WHERE company_id = p_company_id;

  INSERT INTO company_coa_versions (company_id, version_no, effective_from)
  VALUES (p_company_id, v_version_no, p_effective_from)
  RETURNING id INTO v_version_id;

  INSERT INTO company_coa_accounts (
    id, company_id, account_code, name_ar, name_en, name_fr,
    normal_balance, is_postable, parent_account_id, template_account_id, version_id
  )
  SELECT
    gen_random_uuid(), p_company_id, t.account_code, t.name_ar, t.name_en, t.name_fr,
    map_normal_balance(t.normal_balance_raw), t.is_postable_default,
    NULL, t.id, v_version_id
  FROM coa_template_accounts t
  WHERE t.template_id = v_template_id;

  RETURN v_version_id;
END;
$$ LANGUAGE plpgsql;
