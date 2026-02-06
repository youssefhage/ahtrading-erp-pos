-- Create company COA instances from Lebanese template (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM company_coa_versions
    WHERE company_id = '00000000-0000-0000-0000-000000000001'
  ) THEN
    PERFORM clone_coa_template_to_company('00000000-0000-0000-0000-000000000001', 'LB_COA_2025', '2026-01-30');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM company_coa_versions
    WHERE company_id = '00000000-0000-0000-0000-000000000002'
  ) THEN
    PERFORM clone_coa_template_to_company('00000000-0000-0000-0000-000000000002', 'LB_COA_2025', '2026-01-30');
  END IF;
END $$;
